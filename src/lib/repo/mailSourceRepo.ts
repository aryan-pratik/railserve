import type { Types } from 'mongoose'
import { connectDb } from '../db'
import { Order } from '../models'

/*
 * The two order reads Settings → Order emails needs. Admin-only callers
 * (company.manage), scoped to the tenant; they read the stored email of an
 * order, never its customer or money fields.
 */

/** Who sent each aggregator's orders since a date, and whether Gmail verified them. */
export async function orderSendersSince(tenantId: Types.ObjectId, since: Date) {
  await connectDb()
  return Order.aggregate<{ _id: { source: string; from: string | null; v: boolean | null }; n: number }>([
    { $match: { tenantId, createdAt: { $gte: since }, source: { $ne: 'MANUAL' }, 'rawPayload.from': { $type: 'string' } } },
    { $group: { _id: { source: '$source', from: '$rawPayload.from', v: '$rawPayload.auth.verified' }, n: { $sum: 1 } } },
    { $limit: 2000 },
  ])
}

/** The stored emails of recent orders, newest first, to test a taught layout on. */
export async function recentOrderEmails(tenantId: Types.ObjectId, since: Date, limit = 300) {
  await connectDb()
  return Order.find({ tenantId, createdAt: { $gte: since }, 'rawPayload.from': { $type: 'string' } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select('rawPayload')
    .lean()
}
