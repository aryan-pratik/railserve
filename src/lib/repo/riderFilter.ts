import mongoose from 'mongoose'
import { User } from '@/lib/models'
import type { AuthContext } from '@/lib/authContext'
import { riderRecordOf } from './orderRepo'

/** The rider filter's value for orders no rider is on yet. */
export const NO_RIDER = 'none'

export type RiderOption = { id: string; name: string; active: boolean }

/**
 * The riders a caller can filter order history by.
 *
 * Inactive riders stay in the list: history is exactly where someone asks
 * which orders a rider who has since left carried. An admin sees every rider;
 * a manager sees the riders attached to the outlets they hold.
 */
export async function riderOptions(ctx: AuthContext): Promise<RiderOption[]> {
  const filter: Record<string, unknown> = { role: 'DELIVERY_AGENT' }
  if (ctx.role !== 'ADMIN') filter.restaurantIds = { $in: ctx.restaurantIds }
  const riders = await User.find(filter).select('name active').sort({ active: -1, name: 1 }).lean()
  return riders.map((r) => ({ id: String(r._id), name: r.name, active: r.active !== false }))
}

/**
 * The order-filter clause for a `rider` query value, or null for none.
 *
 * `delivery.agentIds` holds whoever has the order: written when an admin or
 * manager assigns it and when a rider takes it off the counter. A value that
 * is neither NO_RIDER nor an id is ignored rather than cast, so a mangled URL
 * shows unfiltered history instead of an error page.
 */
export function riderClause(rider: string): Record<string, unknown> | null {
  if (rider === NO_RIDER) return { 'delivery.agentIds.0': { $exists: false } }
  // Everyone on the order, not only its carrier: the rule the day's-orders
  // screens share (see "What counts" in lib/analytics). The rider ledger asks
  // a different question, who carried it, and uses onClosedRecord instead.
  if (mongoose.isValidObjectId(rider)) return { 'delivery.agentIds': new mongoose.Types.ObjectId(rider) }
  return null
}

/**
 * Adds a whole clause to a filter under $and.
 *
 * The rider clause and the search clause are each a top-level `$or`, so
 * copying both onto one filter object lets the second replace the first, and
 * the list quietly stops being filtered by rider. This keeps every clause.
 */
export function andClause(filter: Record<string, unknown>, clause: Record<string, unknown> | null): void {
  if (!clause) return
  filter.$and = [...((filter.$and as unknown[] | undefined) ?? []), clause]
}

/**
 * Rider names for a page of orders, joined per order as the table shows them.
 * Looked up by id rather than from riderOptions, so an order carried by a
 * rider from another outlet still names them.
 */
export async function riderNamesFor(
  orders: { _id: unknown; delivery?: { agentIds?: unknown[] | null; pickedUpBy?: unknown } | null }[],
): Promise<Map<string, string>> {
  // Once somebody has picked an order up, they are its rider: the others it
  // was offered to are no longer named beside it.
  const ids = [...new Set(orders.flatMap((o) => riderRecordOf(o)))]
  if (ids.length === 0) return new Map()
  const users = await User.find({ _id: { $in: ids } }).select('name').lean()
  const name = new Map(users.map((u) => [String(u._id), u.name]))
  return new Map(
    orders.map((o) => [
      String(o._id),
      riderRecordOf(o).map((id) => name.get(id) ?? 'Unknown rider').join(', '),
    ]),
  )
}
