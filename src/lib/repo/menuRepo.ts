import mongoose from 'mongoose'
import { connectDb } from '@/lib/db'
import { MenuItem, Order } from '@/lib/models'
import { ForbiddenError, type AuthContext } from '@/lib/authContext'
import { ORDER_SOURCES, type OrderSource } from '@/lib/orderEnums'
import {
  isDiet,
  menuKey,
  menuLookupKey,
  orderDiet,
  splitKotParts,
  suggestDiet,
  type Diet,
  type DietLookup,
  type OrderDiet,
} from '@/lib/diet'

/**
 * The menu database: every dish each aggregator has sent us, and whether it is
 * veg or non-veg. See models/MenuItem.ts for the shape and lib/diet.ts for
 * how the tag is used.
 */

type ItemLike = { name: string; isPacking?: boolean | null }

function knownSource(source: string | null | undefined): OrderSource {
  return (ORDER_SOURCES as readonly string[]).includes(source ?? '') ? (source as OrderSource) : 'MANUAL'
}

/**
 * Adds any dish on these items that the menu does not have yet, with a
 * suggested tag that stays unconfirmed. Never touches a row that exists: a
 * tag somebody set is not overwritten by a new order.
 */
export async function registerMenuItems(
  rows: { source: string | null | undefined; name: string }[],
): Promise<number> {
  const seen = new Map<string, { source: OrderSource; key: string; name: string }>()
  for (const r of rows) {
    const key = menuKey(r.name)
    if (!key) continue
    const source = knownSource(r.source)
    const id = `${source}|${key}`
    if (!seen.has(id)) seen.set(id, { source, key, name: r.name.trim().replace(/\s+/g, ' ') })
  }
  if (seen.size === 0) return 0

  await connectDb()
  const res = await MenuItem.bulkWrite(
    [...seen.values()].map((r) => ({
      updateOne: {
        filter: { source: r.source, key: r.key },
        update: {
          $setOnInsert: { source: r.source, key: r.key, name: r.name, diet: suggestDiet(r.name), reviewed: false },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  )
  return res.upsertedCount
}

/** The food on one order, for registerMenuItems. */
export function menuRowsOf(order: { source?: string | null; items?: ItemLike[] | null }) {
  return (order.items ?? [])
    .filter((i) => !i.isPacking)
    .map((i) => ({ source: order.source, name: i.name }))
}

/**
 * The tags for every dish on these orders, in one query. Keyed by
 * menuLookupKey, which is what dietFor / splitKotParts read.
 */
export async function dietLookupFor(
  orders: { source?: string | null; items?: ItemLike[] | null }[],
): Promise<DietLookup> {
  const sources = new Set<OrderSource>()
  const keys = new Set<string>()
  for (const o of orders) {
    for (const i of o.items ?? []) {
      if (i.isPacking) continue
      sources.add(knownSource(o.source))
      keys.add(menuKey(i.name))
    }
  }
  const lookup = new Map<string, Diet | null>()
  if (keys.size === 0) return lookup

  await connectDb()
  const rows = await MenuItem.find({ source: { $in: [...sources] }, key: { $in: [...keys] } })
    .select('source key diet')
    .lean()
  for (const r of rows) lookup.set(`${r.source}|${r.key}`, isDiet(r.diet) ? r.diet : null)
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

  const counted = await Order.aggregate<{
    _id: { source: string; name: string }
    orders: number
    qty: number
    last: Date | null
  }>([
    { $match: { status: { $ne: 'RATING_ORDER' } } },
    { $project: { source: 1, items: 1, createdAt: 1 } },
    { $unwind: '$items' },
    { $match: { 'items.isPacking': { $ne: true } } },
    {
      $group: {
        _id: { source: '$source', name: { $toLower: { $trim: { input: '$items.name' } } }, order: '$_id' },
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
  ])

  // Several raw spellings can share one key ("Aloo Paratha", "aloo  paratha.").
  const counts = new Map<string, { orders: number; qty: number; last: Date | null; name: string; source: string }>()
  for (const c of counted) {
    const id = menuLookupKey(knownSource(c._id.source), c._id.name)
    const prev = counts.get(id)
    if (prev) {
      prev.orders += c.orders
      prev.qty += c.qty
      if (c.last && (!prev.last || c.last > prev.last)) prev.last = c.last
    } else {
      counts.set(id, { orders: c.orders, qty: c.qty, last: c.last, name: c._id.name, source: knownSource(c._id.source) })
    }
  }

  const allItems = () => MenuItem.find({}).select('source key name diet reviewed').lean()
  let items = await allItems()
  const known = new Set(items.map((i) => `${i.source}|${i.key}`))
  const missing = [...counts.entries()].filter(([id]) => !known.has(id)).map(([, c]) => c)
  if (missing.length > 0) {
    // Names here are lowercased by the aggregation; take the spelling from an
    // actual order so the row reads the way the aggregator writes it.
    const spelled = await spellingsFor(missing)
    await registerMenuItems(missing.map((m) => ({ source: m.source, name: spelled.get(`${m.source}|${menuKey(m.name)}`) ?? m.name })))
    items = await allItems()
  }

  return items
    .map((i) => {
      const c = counts.get(`${i.source}|${i.key}`)
      return {
        id: String(i._id),
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

/** One real spelling per (source, key), from the newest order carrying it. */
async function spellingsFor(rows: { source: string; name: string }[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const bySource = new Map<string, string[]>()
  for (const r of rows) bySource.set(r.source, [...(bySource.get(r.source) ?? []), r.name])
  for (const [source, names] of bySource) {
    const found = await Order.aggregate<{ _id: string; name: string }>([
      { $match: { source } },
      { $sort: { createdAt: -1 } },
      { $unwind: '$items' },
      { $project: { name: '$items.name', lower: { $toLower: { $trim: { input: '$items.name' } } } } },
      { $match: { lower: { $in: names } } },
      { $group: { _id: '$lower', name: { $first: '$name' } } },
    ])
    for (const f of found) out.set(`${source}|${menuKey(f._id)}`, f.name)
  }
  return out
}

/** Set (or clear) a dish's tag. Setting it is what confirms it. */
export async function setMenuItemDiet(ctx: AuthContext, id: string, diet: Diet | null): Promise<void> {
  if (ctx.role !== 'ADMIN') throw new ForbiddenError('Only an admin may tag menu items.')
  if (!mongoose.isValidObjectId(id)) throw new Error('Unknown menu item')
  await connectDb()
  await MenuItem.updateOne(
    { _id: new mongoose.Types.ObjectId(id) },
    {
      $set: {
        diet,
        reviewed: diet !== null,
        reviewedBy: diet !== null ? ctx.userId : null,
        reviewedAt: diet !== null ? new Date() : null,
      },
    },
  )
}

/** Accept the suggested tag on these rows as they stand. */
export async function confirmMenuItems(ctx: AuthContext, ids: string[]): Promise<number> {
  if (ctx.role !== 'ADMIN') throw new ForbiddenError('Only an admin may tag menu items.')
  const valid = ids.filter((id) => mongoose.isValidObjectId(id)).map((id) => new mongoose.Types.ObjectId(id))
  if (valid.length === 0) return 0
  await connectDb()
  const res = await MenuItem.updateMany(
    { _id: { $in: valid }, diet: { $in: ['VEG', 'NON_VEG'] }, reviewed: false },
    { $set: { reviewed: true, reviewedBy: ctx.userId, reviewedAt: new Date() } },
  )
  return res.modifiedCount
}

/**
 * How many KOT parts each of these orders prints: one, or two when it carries
 * both veg and non-veg. Worked out from the same tags and the same split the
 * ticket itself uses. Unscoped on purpose: the print queue calls it with ids
 * it has already been entitled to print, and only a count comes back.
 */
export async function kotPartCounts(orderIds: string[]): Promise<Map<string, number>> {
  const valid = orderIds.filter((id) => mongoose.isValidObjectId(id))
  if (valid.length === 0) return new Map()
  await connectDb()
  const orders = await Order.find({ _id: { $in: valid } }).select('source items.name items.isPacking').lean()
  const lookup = await dietLookupFor(orders)
  return new Map(orders.map((o) => [String(o._id), splitKotParts(lookup, o.source, o.items).length]))
}
