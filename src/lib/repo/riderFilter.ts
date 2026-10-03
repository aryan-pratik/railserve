import mongoose from 'mongoose'
import { User } from '@/lib/models'
import type { AuthContext } from '@/lib/authContext'

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
  if (mongoose.isValidObjectId(rider)) {
    return { 'delivery.agentIds': new mongoose.Types.ObjectId(rider) }
  }
  return null
}

/**
 * Rider names for a page of orders, joined per order as the table shows them.
 * Looked up by id rather than from riderOptions, so an order carried by a
 * rider from another outlet still names them.
 */
export async function riderNamesFor(
  orders: { _id: unknown; delivery?: { agentIds?: unknown[] | null } | null }[],
): Promise<Map<string, string>> {
  const ids = [...new Set(orders.flatMap((o) => (o.delivery?.agentIds ?? []).map(String)))]
  if (ids.length === 0) return new Map()
  const users = await User.find({ _id: { $in: ids } }).select('name').lean()
  const name = new Map(users.map((u) => [String(u._id), u.name]))
  return new Map(
    orders.map((o) => [
      String(o._id),
      (o.delivery?.agentIds ?? []).map((id) => name.get(String(id)) ?? 'Unknown rider').join(', '),
    ]),
  )
}
