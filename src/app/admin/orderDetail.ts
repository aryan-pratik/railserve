'use server'

import { requireRole } from '@/lib/session'
import { findById } from '@/lib/repo/orderRepo'
import { connectDb } from '@/lib/db'
import { Restaurant, User } from '@/lib/models'
import { timingForOrders, timingFor } from '@/lib/train/service'
import { allowedNextStatuses, type OrderStatus } from '@/lib/orderStatus'

/**
 * Everything the slide-over shows, in one round trip.
 *
 * Fetched on open rather than pre-loaded with the list: the board renders every
 * order on the day, and shipping each one's items, event log and live timing to
 * the browser up front would be a large payload for a panel that opens on one
 * order at a time.
 *
 * Fully serialisable — Dates out as ISO strings, ObjectIds as strings — because
 * it crosses to a client component.
 */
export type OrderDetail = {
  id: string
  externalOrderId: string
  status: string
  orderType: string
  outlet: { name: string; stationCode: string } | null
  serviceDate: string
  trainNo: string | null
  trainName: string | null
  scheduledArrival: string | null
  /** Live view, when the train is being tracked. */
  expectedArrival: string | null
  delayMinutes: number | null
  platform: string | null
  timingSource: 'LIVE' | 'SCHEDULED'
  stale: boolean
  seat: string | null
  handoverPoint: string | null
  pax: number | null
  contactName: string | null
  contactPhone: string | null
  amountPaise: number | null
  paymentMode: string | null
  notes: string | null
  items: { id: string; name: string; qty: number; pricePaise: number | null; isPacking: boolean; spec: string | null }[]
  events: { id: string; toStatus: string; fromStatus: string | null; actor: string; at: string; action: string | null }[]
  /** Transitions this admin may perform from here, already labelled. */
  nextStatuses: { to: string; label: string; danger: boolean }[]
}

const LABEL: Record<string, string> = {
  ACCEPTED: 'Mark as accepted',
  KOT_PRINTED: 'Send KOT to kitchen',
  PREPARED: 'Mark ready',
  DISPATCHED: 'Mark on platform',
  DELIVERED: 'Mark delivered',
  FAILED: 'Mark failed',
  CANCELLED: 'Cancel order',
  QUOTED: 'Send quote',
  RECEIVED: 'Confirm order',
  LOST: 'Mark lost',
}

export async function fetchOrderDetail(orderId: string): Promise<OrderDetail | null> {
  const ctx = await requireRole('ADMIN')

  const order = await findById(ctx, orderId)
  if (!order) return null

  await connectDb()
  const actorIds = order.events.map((e) => e.userId).filter((v) => v != null)
  const [outlet, actors, timings] = await Promise.all([
    order.restaurantId
      ? Restaurant.findById(order.restaurantId).select('name stationCode').lean()
      : null,
    User.find({ _id: { $in: actorIds } }).select('name').lean(),
    // Cache-only: opening a panel must not block on an 8s provider call.
    timingForOrders([order], { allowFetch: false }),
  ])

  const actorName = new Map(actors.map((a) => [String(a._id), a.name]))
  const t = timingFor(order, timings)

  return {
    id: String(order._id),
    externalOrderId: order.externalOrderId,
    status: order.status,
    orderType: order.orderType,
    outlet: outlet ? { name: outlet.name, stationCode: outlet.stationCode } : null,
    serviceDate: order.serviceDate,
    trainNo: order.trainNo ?? null,
    trainName: order.trainName ?? null,
    scheduledArrival: order.scheduledArrival?.toISOString() ?? null,
    expectedArrival: t.effectiveArrival?.toISOString() ?? null,
    delayMinutes: t.delayMinutes,
    platform: t.platform,
    timingSource: t.source,
    stale: t.stale,
    seat: order.rawSeat ?? null,
    handoverPoint: order.handoverPoint ?? null,
    pax: order.pax ?? null,
    contactName: order.contactName ?? null,
    contactPhone: order.contactPhone ?? null,
    amountPaise: order.amountPaise ?? null,
    paymentMode: order.paymentMode ?? null,
    notes: order.notes ?? null,
    items: order.items.map((i) => ({
      id: String(i._id),
      name: i.name,
      qty: i.qty,
      pricePaise: i.pricePaise ?? null,
      isPacking: i.isPacking,
      spec: i.spec ?? null,
    })),
    events: order.events.map((e) => ({
      id: String(e._id),
      toStatus: e.toStatus,
      fromStatus: e.fromStatus ?? null,
      actor: e.userId ? (actorName.get(String(e.userId)) ?? 'Unknown user') : 'System',
      at: e.createdAt.toISOString(),
      action: (e.meta as { action?: string } | undefined)?.action ?? null,
    })),
    nextStatuses: allowedNextStatuses(order.status as OrderStatus, 'ADMIN').map((to) => ({
      to,
      label: LABEL[to] ?? to,
      danger: to === 'CANCELLED' || to === 'FAILED' || to === 'LOST',
    })),
  }
}
