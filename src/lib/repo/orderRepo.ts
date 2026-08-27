import mongoose, { type QueryFilter } from 'mongoose'
import { Order, Counter, type OrderDoc } from '../models'
import { type AuthContext, NotFoundError } from '../authContext'

/**
 * THE ONLY PLACE Order.find / findOne / aggregate MAY BE CALLED.
 *
 * Plan §2: MongoDB has no row-level security, so store isolation is purely a
 * discipline problem in application code. The discipline is this file plus the
 * ESLint rule that fails the build on direct model access anywhere else.
 *
 * Every read is filtered by the caller's context before it reaches Mongo, so a
 * forgotten `.where()` at a call site cannot leak another outlet's orders —
 * call sites are not given the opportunity to forget.
 */

/**
 * Builds the mandatory filter for a caller.
 *
 * - ADMIN sees everything.
 * - STORE_MANAGER sees only their own outlet.
 * - DELIVERY_AGENT sees only orders they are assigned to.
 *
 * A STORE_MANAGER with a null restaurantId is a data error, not an admin —
 * returning an impossible filter is the safe reading. Same for an agent.
 */
function scopeFilter(ctx: AuthContext): QueryFilter<OrderDoc> {
  switch (ctx.role) {
    case 'ADMIN':
      return {}
    case 'STORE_MANAGER':
      return ctx.restaurantId
        ? { restaurantId: ctx.restaurantId }
        : { _id: { $exists: false } }
    case 'DELIVERY_AGENT':
      return { 'delivery.agentIds': ctx.userId }
  }
}

/** Merge the caller's scope with a caller-supplied filter. */
export function scoped(ctx: AuthContext, filter: QueryFilter<OrderDoc> = {}): QueryFilter<OrderDoc> {
  const scope = scopeFilter(ctx)
  if (Object.keys(scope).length === 0) return filter
  if (Object.keys(filter).length === 0) return scope
  return { $and: [scope, filter] }
}

export async function findMany(
  ctx: AuthContext,
  filter: QueryFilter<OrderDoc> = {},
  opts: { sort?: Record<string, 1 | -1>; limit?: number } = {},
) {
  return Order.find(scoped(ctx, filter))
    .sort(opts.sort ?? { createdAt: -1 })
    .limit(opts.limit ?? 200)
    .lean()
}

/**
 * Fetch one order by id, within scope.
 *
 * Returns null rather than throwing when the order exists but belongs to
 * someone else — callers turn that into a 404. A 403 would confirm the order
 * exists, which is itself a cross-tenant leak.
 */
export async function findById(ctx: AuthContext, id: string) {
  if (!mongoose.isValidObjectId(id)) return null
  return Order.findOne(scoped(ctx, { _id: new mongoose.Types.ObjectId(id) })).lean()
}

export async function findByIdOrThrow(ctx: AuthContext, id: string) {
  const order = await findById(ctx, id)
  if (!order) throw new NotFoundError('Order not found')
  return order
}

export async function countByStatus(ctx: AuthContext, filter: QueryFilter<OrderDoc> = {}) {
  const rows = await Order.aggregate([
    { $match: scoped(ctx, filter) },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ])
  return Object.fromEntries(rows.map((r) => [r._id as string, r.count as number]))
}

/** Distinct restaurant ids present in scope — used to build filter dropdowns. */
export async function findRestaurantIdsInScope(ctx: AuthContext) {
  return Order.distinct('restaurantId', scoped(ctx))
}

/**
 * Mints the next human-readable manual order id: MAN-20260827-001.
 * Atomic via $inc, so two admins submitting at once cannot collide.
 */
export async function nextManualOrderId(serviceDate: string): Promise<string> {
  const key = `manualOrder:${serviceDate}`
  const doc = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' },
  )
  const seq = String(doc!.seq).padStart(3, '0')
  return `MAN-${serviceDate.replace(/-/g, '')}-${seq}`
}

/** Order creation. Status is set here once, and only here, at birth. */
export async function insertOrder(doc: Record<string, unknown>) {
  return Order.create(doc)
}

/**
 * Raw unscoped handle, for the transition engine and ingestion only.
 * Named to be conspicuous in a diff — if you are reaching for this from a
 * page or a route handler, you want `scoped()` instead.
 */
export const __unsafeOrderModel = Order
