import mongoose from 'mongoose'
import { connectDb } from '@/lib/db'
import { MenuItem, Order } from '@/lib/models'
import { ForbiddenError, type AuthContext } from '@/lib/authContext'
import type { OrderSource } from '@/lib/orderEnums'
import {
  isDiet,
  isMenuDish,
  menuKey,
  menuLookupKey,
  menuSource,
  orderDiet,
  type Diet,
  type ItemLike,
  type MenuTag,
  type DietLookup,
  type OrderDiet,
} from '@/lib/diet'
import { suggestDiet } from '@/lib/dietSuggest'
import { naturalKey, tenantKey } from '@/lib/tenancy/primary'

/**
 * The menu database: every dish each aggregator has sent us, and whether it is
 * veg or non-veg. See models/MenuItem.ts for the shape and lib/diet.ts for
 * how the tag is used.
 */

type OrderItems = { source?: string | null; items?: (ItemLike & { notes?: string | null })[] | null }

/** A dish to add if the menu does not have it. `hint` is free text seen with it (the item's note). */
export type MenuCandidate = { source: string | null | undefined; name: string; hint?: string | null }

/** True when every write that failed, failed only because the row already existed. */
function onlyDuplicates(err: unknown): boolean {
  const e = err as { code?: number; writeErrors?: unknown }
  const writeErrors = (Array.isArray(e?.writeErrors) ? e.writeErrors : []) as { code?: number; err?: { code?: number } }[]
  if (writeErrors.length > 0) return writeErrors.every((w) => (w.code ?? w.err?.code) === 11000)
  return e?.code === 11000
}

/**
 * Adds any dish on these rows that the menu does not have yet, with a
 * suggested tag that stays unconfirmed (or no tag, when the name does not say
 * enough). Never changes the tag on a row that exists: a tag somebody set is
 * not overwritten by a new order. A dish that was deleted from the Menu page
 * is put back on it, tag as it was, because it is being ordered again.
 *
 * Safe to call from many requests at once: the row's _id is the (aggregator,
 * dish) pair (under the tenant's key), so the second writer of the same dish
 * is simply a no-op.
 */
export async function registerMenuItems(
  tenantId: mongoose.Types.ObjectId,
  rows: MenuCandidate[],
  opts: { restore?: boolean } = {},
): Promise<number> {
  // `restore: false` is for back-filling from orders already taken: those
  // say nothing about a dish being ordered again, so a deleted one stays so.
  const restore = opts.restore !== false
  const seen = new Map<string, { source: OrderSource; key: string; name: string; hint: string | null }>()
  for (const r of rows) {
    const key = menuKey(r.name)
    if (!key || !isMenuDish({ name: r.name })) continue
    const id = menuLookupKey(r.source, r.name)
    if (!seen.has(id)) {
      seen.set(id, { source: menuSource(r.source), key, name: r.name.trim().replace(/\s+/g, ' '), hint: r.hint ?? null })
    }
  }
  if (seen.size === 0) return 0

  await connectDb()
  const keyed = await Promise.all([...seen.entries()].map(async ([id, r]) => [await tenantKey(tenantId, id), r] as const))
  try {
    // bulkWrite runs no query middleware, so the tenant guard never sees
    // these: the filter names the tenant itself, and the upsert copies it on.
    const res = await MenuItem.bulkWrite(
      keyed.map(([id, r]) => ({
        updateOne: {
          filter: { _id: id, tenantId },
          update: {
            $setOnInsert: { source: r.source, key: r.key, name: r.name, diet: suggestDiet(r.name, r.hint), reviewed: false },
            ...(restore ? { $set: { removedAt: null } } : {}),
          },
          upsert: true,
        },
      })),
      { ordered: false },
    )
    return res.upsertedCount
  } catch (err) {
    // Two requests carrying the same new dish can both try to insert it. The
    // loser's error means the row is there, which is all this function wants.
    if (!onlyDuplicates(err)) throw err
    return (err as { result?: { upsertedCount?: number } }).result?.upsertedCount ?? 0
  }
}

/**
 * The dishes on one order, for registerMenuItems. Packing lines and composite
 * items (a bulk thali, whose name is "Bulk thali × 40" and not a dish) are
 * left out: see isMenuDish.
 */
export function menuRowsOf(order: OrderItems): MenuCandidate[] {
  return (order.items ?? [])
    .filter((i) => isMenuDish(i))
    .map((i) => ({ source: order.source, name: i.name, hint: i.notes ?? null }))
}

/**
 * Registers whatever is on this order now. For the places that change an
 * existing order's items or its aggregator, called after the change has been
 * saved. Never throws: the menu catching up must not fail an edit that has
 * already happened, and the Menu page back-fills anything missed.
 */
export async function registerOrderMenu(tenantId: mongoose.Types.ObjectId, orderId: string): Promise<void> {
  try {
    if (!mongoose.isValidObjectId(orderId)) return
    await connectDb()
    const order = await Order.findOne({ _id: orderId, tenantId }).select('source items.name items.isPacking items.spec items.notes').lean()
    if (order) await registerMenuItems(tenantId, menuRowsOf(order))
  } catch (err) {
    console.error('[menu] could not register the dishes on order', orderId, err)
  }
}

/**
 * The tags for every dish on these orders, in one query. Keyed by
 * menuLookupKey (the natural key, without the tenant prefix), which is what
 * tagFor / splitKotParts read.
 */
export async function dietLookupFor(tenantId: mongoose.Types.ObjectId, orders: OrderItems[]): Promise<DietLookup> {
  const ids = new Set<string>()
  for (const o of orders) {
    for (const i of o.items ?? []) {
      // An item tagged on the order itself never consults the menu.
      if (isMenuDish(i) && !isDiet(i.diet)) ids.add(menuLookupKey(o.source, i.name))
    }
  }
  const lookup = new Map<string, MenuTag>()
  if (ids.size === 0) return lookup

  await connectDb()
  const keys = await Promise.all([...ids].map((id) => tenantKey(tenantId, id)))
  const rows = await MenuItem.find({ _id: { $in: keys }, tenantId }).select('diet reviewed').lean()
  for (const r of rows) lookup.set(naturalKey(r._id), { diet: isDiet(r.diet) ? r.diet : null, reviewed: Boolean(r.reviewed) })
  return lookup
}

/** Each order's one-mark summary, keyed by order id, for the boards. */
export async function orderDietsFor(
  tenantId: mongoose.Types.ObjectId,
  orders: { _id: unknown; source?: string | null; items: ItemLike[] }[],
): Promise<Map<string, OrderDiet>> {
  const lookup = await dietLookupFor(tenantId, orders)
  return new Map(orders.map((o) => [String(o._id), orderDiet(lookup, o)]))
}

export type MenuRow = {
  id: string
  source: string
  name: string
  diet: Diet | null
  reviewed: boolean
  /** Orders carrying this dish, ever, and how many plates. */
  orderCount: number
  qty: number
  lastOrderedAt: string | null
}

/**
 * The whole menu with how often each dish is ordered.
 *
 * Counts come straight from the orders, grouped by aggregator and name, so
 * they are never a second number that can drift. Any dish found there that
 * the menu does not have yet is added on the way (registerMenuItems), which
 * is what keeps the table complete even for orders that arrived before it
 * existed or were edited by hand since.
 */
export async function menuOverview(ctx: AuthContext): Promise<MenuRow[]> {
  if (ctx.role !== 'ADMIN') throw new ForbiddenError('Only an admin may manage the menu.')
  await connectDb()

  // Grouped on the name exactly as written, so the spelling survives; the
  // spellings that share one key are folded together below.
  const counted = await Order.aggregate<{
    _id: { source: string; name: string }
    orders: number
    qty: number
    last: Date | null
  }>([
    { $match: { tenantId: ctx.tenantId, status: { $ne: 'RATING_ORDER' } } },
    { $project: { source: 1, items: 1, createdAt: 1 } },
    { $unwind: '$items' },
    {
      // The same test as isMenuDish: not packing, and no composite spec.
      $match: {
        'items.isPacking': { $ne: true },
        $expr: { $eq: [{ $trim: { input: { $ifNull: ['$items.spec', ''] } } }, ''] },
      },
    },
    {
      $group: {
        _id: { source: '$source', name: '$items.name', order: '$_id' },
        qty: { $sum: '$items.qty' },
        at: { $max: '$createdAt' },
      },
    },
    {
      $group: {
        _id: { source: '$_id.source', name: '$_id.name' },
        orders: { $sum: 1 },
        qty: { $sum: '$qty' },
        last: { $max: '$at' },
      },
    },
  ]).allowDiskUse(true)

  // Several raw spellings can share one key ("Aloo Paratha", "aloo  paratha.").
  // An order carrying two spellings of one dish counts once per spelling;
  // that is rare enough, and harmless enough, not to pay for a second pass.
  const counts = new Map<string, { orders: number; qty: number; last: Date | null; name: string; source: OrderSource }>()
  for (const c of counted) {
    if (typeof c._id.name !== 'string' || !menuKey(c._id.name)) continue
    // The bulk thali line, whether or not its menu text was typed in.
    if (!isMenuDish({ name: c._id.name })) continue
    const id = menuLookupKey(c._id.source, c._id.name)
    const prev = counts.get(id)
    if (prev) {
      prev.orders += c.orders
      prev.qty += c.qty
      if (c.last && (!prev.last || c.last > prev.last)) {
        prev.last = c.last
        prev.name = c._id.name
      }
    } else {
      counts.set(id, { orders: c.orders, qty: c.qty, last: c.last, name: c._id.name, source: menuSource(c._id.source) })
    }
  }

  // Deleted dishes are read too: they count as known, so the orders that
  // still carry one do not add it straight back. They are left off below.
  // Keyed by the natural (source|dish) id, the one the browser sends back.
  const allItems = async () =>
    (await MenuItem.find({ tenantId: ctx.tenantId }).select('source name diet reviewed removedAt').lean()).map((i) => ({
      ...i,
      _id: naturalKey(i._id),
    }))
  let items = await allItems()
  const known = new Set(items.map((i) => i._id))
  // A deleted dish on an order newer than its deletion should have been put
  // back when that order arrived. If that was missed, it is put back here.
  const removedAt = new Map(items.filter((i) => i.removedAt).map((i) => [i._id, i.removedAt as Date]))
  const missing = [...counts.entries()]
    .filter(([id, c]) => {
      if (!known.has(id)) return true
      const gone = removedAt.get(id)
      return Boolean(gone && c.last && c.last > gone)
    })
    .map(([, c]) => c)
  if (missing.length > 0) {
    await registerMenuItems(ctx.tenantId, missing.map((m) => ({ source: m.source, name: m.name })))
    items = await allItems()
  }

  return items
    .filter((i) => !i.removedAt)
    .map((i) => {
      const c = counts.get(i._id)
      return {
        id: i._id,
        source: i.source,
        name: i.name,
        diet: isDiet(i.diet) ? i.diet : null,
        reviewed: Boolean(i.reviewed),
        orderCount: c?.orders ?? 0,
        qty: c?.qty ?? 0,
        lastOrderedAt: c?.last?.toISOString() ?? null,
      }
    })
    .sort((a, b) => b.orderCount - a.orderCount || a.name.localeCompare(b.name))
}

/** A menu row's id as it arrives from the browser: a string, and nothing else. */
function isMenuId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 2 && id.length <= 600 && id.includes('|')
}

/** Set (or clear) a dish's tag. Setting it is what confirms it. */
export async function setMenuItemDiet(ctx: AuthContext, id: string, diet: Diet | null): Promise<void> {
  if (ctx.role !== 'ADMIN') throw new ForbiddenError('Only an admin may tag menu items.')
  if (!isMenuId(id)) throw new Error('Unknown menu item')
  if (diet !== null && !isDiet(diet)) throw new Error('Unknown tag')
  await connectDb()
  const res = await MenuItem.updateOne(
    { _id: await tenantKey(ctx.tenantId, id), tenantId: ctx.tenantId },
    {
      $set: {
        diet,
        reviewed: diet !== null,
        reviewedBy: diet !== null ? ctx.userId : null,
        reviewedAt: diet !== null ? new Date() : null,
      },
    },
  )
  if (res.matchedCount === 0) throw new Error('Unknown menu item')
}

/** Accept the suggested tag on these rows as they stand. */
export async function confirmMenuItems(ctx: AuthContext, ids: string[]): Promise<number> {
  if (ctx.role !== 'ADMIN') throw new ForbiddenError('Only an admin may tag menu items.')
  const valid = (Array.isArray(ids) ? ids : []).filter(isMenuId)
  if (valid.length === 0) return 0
  await connectDb()
  const res = await MenuItem.updateMany(
    {
      _id: { $in: await Promise.all(valid.map((id) => tenantKey(ctx.tenantId, id))) },
      tenantId: ctx.tenantId,
      diet: { $in: ['VEG', 'NON_VEG'] },
      reviewed: false,
    },
    { $set: { reviewed: true, reviewedBy: ctx.userId, reviewedAt: new Date() } },
  )
  return res.modifiedCount
}

/**
 * Delete a dish from the Menu page.
 *
 * The row is kept and marked, not dropped. Orders already taken may still
 * carry the dish: their KOTs go on reading its tag, and the Menu page, which
 * adds every dish it finds on the orders, does not put it straight back. The
 * next order that arrives with the dish does (registerMenuItems).
 */
export async function removeMenuItem(ctx: AuthContext, id: string): Promise<void> {
  if (ctx.role !== 'ADMIN') throw new ForbiddenError('Only an admin may delete menu items.')
  if (!isMenuId(id)) throw new Error('Unknown menu item')
  await connectDb()
  const res = await MenuItem.updateOne(
    { _id: await tenantKey(ctx.tenantId, id), tenantId: ctx.tenantId },
    { $set: { removedAt: new Date() } },
  )
  if (res.matchedCount === 0) throw new Error('Unknown menu item')
}

/**
 * Put a deleted dish back by hand, with the tag given and the name as typed
 * now (it folds to the same key, or the id would differ). False when the dish
 * is not a deleted one (it is on the menu already, or was never there).
 */
export async function restoreMenuItem(ctx: AuthContext, id: string, name: string, diet: Diet): Promise<boolean> {
  if (ctx.role !== 'ADMIN') throw new ForbiddenError('Only an admin may add menu items.')
  if (!isMenuId(id) || !isDiet(diet)) return false
  await connectDb()
  const res = await MenuItem.updateOne(
    { _id: await tenantKey(ctx.tenantId, id), tenantId: ctx.tenantId, removedAt: { $ne: null } },
    { $set: { removedAt: null, name, diet, reviewed: true, reviewedBy: ctx.userId, reviewedAt: new Date() } },
  )
  return res.modifiedCount === 1
}
