import mongoose from 'mongoose'
import { Order, User } from '../models'
import { connectDb } from '../db'
import type { AuthContext } from '../authContext'
import { scoped } from './orderRepo'
import type { ReportOrder } from '../v2/reports'

/*
 * The orders behind Reports, slimmed to what the numbers need. One read for
 * the chosen period and the one it is compared with, through scoped(), so a
 * store manager's Reports only ever cover their own kitchens.
 */

const FIELDS = [
  'serviceDate', 'createdAt', 'scheduledArrival', 'status', 'amountPaise', 'paymentMode', 'source', 'orderType',
  'restaurantId', 'stationCode', 'trainNo', 'trainName', 'contactPhone', 'ratingOrder', 'refund.amountPaise', 'refund.payer',
  'items.name', 'items.qty', 'items.isPacking', 'items.spec', 'events.toStatus',
  'delivery.deliveredAt', 'delivery.dispatchedAt', 'delivery.failureReason', 'delivery.pickedUpBy', 'delivery.agentIds', 'delivery.rto.status',
].join(' ')

export async function loadReportOrders(
  ctx: AuthContext,
  range: { from: string; to: string },
  opts: { outletId?: string | null } = {},
): Promise<ReportOrder[]> {
  await connectDb()
  const filter = {
    tenantId: ctx.tenantId,
    serviceDate: { $gte: range.from, $lte: range.to },
    // Group-booking enquiries and quotes are not orders yet.
    status: { $nin: ['ENQUIRY', 'QUOTED'] },
    ...(opts.outletId && mongoose.isValidObjectId(opts.outletId) ? { restaurantId: new mongoose.Types.ObjectId(opts.outletId) } : {}),
  }
  const rows = await Order.find(scoped(ctx, filter)).select(FIELDS).lean()
  return rows.map((o) => ({
    serviceDate: o.serviceDate,
    createdAt: o.createdAt,
    arrival: o.scheduledArrival ?? null,
    status: o.status,
    amountPaise: o.amountPaise ?? 0,
    paymentMode: o.paymentMode ?? null,
    source: o.source ?? null,
    orderType: o.orderType,
    outletId: o.restaurantId ? String(o.restaurantId) : null,
    stationCode: o.stationCode ?? null,
    trainNo: o.trainNo ?? null,
    trainName: o.trainName ?? null,
    phone: o.contactPhone ?? null,
    ratingOrder: o.ratingOrder === true,
    refundPaise: o.refund?.amountPaise ?? 0,
    refundByUs: o.refund?.payer === 'US',
    items: (o.items ?? []).map((i) => ({ name: i.name, qty: i.qty, isPacking: Boolean(i.isPacking), spec: i.spec ?? null })),
    cooked: (o.events ?? []).some((e) => e.toStatus === 'KOT_PRINTED') || ['KOT_PRINTED', 'PREPARED', 'DISPATCHED', 'DELIVERED', 'FAILED'].includes(o.status),
    deliveredAt: o.delivery?.deliveredAt ?? null,
    dispatchedAt: o.delivery?.dispatchedAt ?? null,
    failureReason: o.delivery?.failureReason ?? null,
    riderId: o.delivery?.pickedUpBy ? String(o.delivery.pickedUpBy) : o.delivery?.agentIds?.[0] ? String(o.delivery.agentIds[0]) : null,
    returned: o.delivery?.rto?.status === 'RETURNED',
  }))
}

/** Of these phone numbers, the ones that ordered before `before`: returning passengers. */
export async function phonesSeenBefore(ctx: AuthContext, phones: string[], before: string): Promise<Set<string>> {
  if (phones.length === 0) return new Set()
  await connectDb()
  const seen = await Order.distinct('contactPhone', scoped(ctx, { tenantId: ctx.tenantId, contactPhone: { $in: phones }, serviceDate: { $lt: before } }))
  return new Set(seen.filter((p): p is string => typeof p === 'string'))
}

/** Rider names, for the riders' table. */
export async function riderNames(ctx: AuthContext, ids: string[]): Promise<Map<string, string>> {
  const valid = ids.filter((id) => mongoose.isValidObjectId(id))
  if (valid.length === 0) return new Map()
  await connectDb()
  const users = await User.find({ _id: { $in: valid }, tenantId: ctx.tenantId }).select('name').lean()
  return new Map(users.map((u) => [String(u._id), u.name]))
}
