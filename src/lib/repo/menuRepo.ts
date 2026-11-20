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
 * enough). Never touches a row that exists: a tag somebody set is not
 * overwritten by a new order.
 *
 * Safe to call from many requests at once: the row's _id is the (aggregator,
 * dish) pair, so the second writer of the same dish is simply a no-op.
 */
export async function registerMenuItems(rows: MenuCandidate[]): Promise<number> {
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
  try {
    const res = await MenuItem.bulkWrite(
      [...seen.entries()].map(([id, r]) => ({
        updateOne: {
          filter: { _id: id },
          update: {
            $setOnInsert: { source: r.source, key: r.key, name: r.name, diet: suggestDiet(r.name, r.hint), reviewed: false },
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
export async function registerOrderMenu(orderId: string): Promise<void> {
  try {
    if (!mongoose.isValidObjectId(orderId)) return
    await connectDb()
    const order = await Order.findById(orderId).select('source items.name items.isPacking items.spec items.notes').lean()
    if (order) await registerMenuItems(menuRowsOf(order))
  } catch (err) {
    console.error('[menu] could not register the dishes on order', orderId, err)
  }
}

/**
 * The tags for every dish on these orders, in one query. Keyed by
 * menuLookupKey, which is what tagFor / splitKotParts read.
 */
export async function dietLookupFor(orders: OrderItems[]): Promise<DietLookup> {
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
  const rows = await MenuItem.find({ _id: { $in: [...ids] } }).select('diet reviewed').lean()
  for (const r of rows) lookup.set(r._id, { diet: isDiet(r.diet) ? r.diet : null, reviewed: Boolean(r.reviewed) })
  return lookup
}

/** Each order's one-mark summary, keyed by order id, for the boards. */
export async function orderDietsFor(
  orders: { _id: unknown; source?: string | null; items: ItemLike[] }[],
): Promise<Map<string, OrderDiet>> {
  const lookup = await dietLookupFor(orders)
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
    { $match: { status: { $ne: 'RATING_ORDER' } } },
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

  const allItems = () => MenuItem.find({}).select('source name diet reviewed').lean()
  let items = await allItems()
  const known = new Set(items.map((i) => i._id))
  const missing = [...counts.entries()].filter(([id]) => !known.has(id)).map(([, c]) => c)
  if (missing.length > 0) {
    await registerMenuItems(missing.map((m) => ({ source: m.source, name: m.name })))
    items = await allItems()
  }

  return items
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
    { _id: id },
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
    { _id: { $in: valid }, diet: { $in: ['VEG', 'NON_VEG'] }, reviewed: false },
    { $set: { reviewed: true, reviewedBy: ctx.userId, reviewedAt: new Date() } },
  )
  return res.modifiedCount
}
