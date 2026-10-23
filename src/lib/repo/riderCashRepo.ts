import mongoose from 'mongoose'
import { Order } from '../models'
import { ConflictError, ForbiddenError, type AuthContext } from '../authContext'
import { COD_WALLET_FROM } from '../riderRecords'
import { scoped } from './orderRepo'

/**
 * Cash a rider is carrying for the store, and the handover that clears it.
 *
 * A rider's wallet is every COD order they delivered that a store manager has
 * not yet taken the cash for. It is derived, never stored: a counter kept
 * alongside would drift the first time a delivery is corrected to "not
 * delivered", and the orders are the record the money is argued over anyway.
 */

export type PendingCash = { paise: number; orders: number; orderIds: string[] }

const EMPTY: PendingCash = { paise: 0, orders: 0, orderIds: [] }

/**
 * Delivered, cash on delivery, not yet handed over — and held by one of
 * `riderIds`. `collectedBy` names the holder; orders closed before it existed
 * fall back to the first rider on the order, so a bulk handover to three
 * riders still counts its cash once.
 */
function pendingFilter(riderIds: mongoose.Types.ObjectId[]) {
  return {
    status: 'DELIVERED' as const,
    paymentMode: 'COD' as const,
    'delivery.codSettledAt': null,
    'delivery.deliveredAt': { $gte: COD_WALLET_FROM },
    $or: [
      { 'delivery.collectedBy': { $in: riderIds } },
      { 'delivery.collectedBy': null, 'delivery.agentIds.0': { $in: riderIds } },
    ],
  }
}

/** Cash per order: what the rider recorded, or the bill when nobody recorded it. */
function cashOf(o: { amountPaise?: number | null; delivery?: { amountCollectedPaise?: number | null } | null }) {
  return o.delivery?.amountCollectedPaise ?? o.amountPaise ?? 0
}

function holderOf(o: { delivery?: { collectedBy?: unknown; agentIds?: unknown[] | null } | null }) {
  return String(o.delivery?.collectedBy ?? o.delivery?.agentIds?.[0] ?? '')
}

/** Pending cash per rider, within the caller's outlets. */
export async function pendingCashByRider(
  ctx: AuthContext,
  riderIds: (string | mongoose.Types.ObjectId)[],
): Promise<Map<string, PendingCash>> {
  const ids = riderIds.map((r) => new mongoose.Types.ObjectId(String(r)))
  const out = new Map<string, PendingCash>()
  if (ids.length === 0) return out

  const orders = await Order.find(scoped(ctx, pendingFilter(ids)))
    .select('amountPaise delivery.amountCollectedPaise delivery.collectedBy delivery.agentIds')
    .lean()

  for (const o of orders) {
    const holder = holderOf(o)
    const prev = out.get(holder) ?? { ...EMPTY, orderIds: [] }
    prev.paise += cashOf(o)
    prev.orders += 1
    prev.orderIds.push(String(o._id))
    out.set(holder, prev)
  }
  return out
}

export async function pendingCashFor(ctx: AuthContext, riderId: mongoose.Types.ObjectId): Promise<PendingCash> {
  return (await pendingCashByRider(ctx, [riderId])).get(String(riderId)) ?? EMPTY
}

/** The rider's most recent handover, for "last handed over ₹X at 9:40". */
export async function lastSettlementFor(
  ctx: AuthContext,
  riderId: mongoose.Types.ObjectId,
): Promise<{ at: string; paise: number; orders: number } | null> {
  const holder = {
    $or: [
      { 'delivery.collectedBy': riderId },
      { 'delivery.collectedBy': null, 'delivery.agentIds.0': riderId },
    ],
  }
  const latest = await Order.findOne(scoped(ctx, { ...holder, 'delivery.codSettledAt': { $ne: null } }))
    .sort({ 'delivery.codSettledAt': -1 })
    .select('delivery.codSettledAt')
    .lean()
  const at = latest?.delivery?.codSettledAt
  if (!at) return null

  const batch = await Order.find(scoped(ctx, { ...holder, 'delivery.codSettledAt': at }))
    .select('amountPaise delivery.amountCollectedPaise')
    .lean()
  return {
    at: new Date(at).toISOString(),
    paise: batch.reduce((sum, o) => sum + cashOf(o), 0),
    orders: batch.length,
  }
}

/**
 * A store manager (or admin) takes a rider's cash.
 *
 * Settles exactly the orders the manager was shown, not "everything pending
 * now": a delivery landing between the page loading and the click would
 * otherwise be marked collected without its cash ever being counted. Orders
 * that stopped qualifying meanwhile — corrected to not delivered, settled by
 * another manager — are skipped, and the returned total is what was actually
 * settled, so the screen can say so.
 *
 * Not a status change; audited on each order's event log like assignRiders.
 */
export async function settleRiderCash(params: {
  ctx: AuthContext
  riderId: string
  orderIds: string[]
  now?: Date
}): Promise<{ orders: number; paise: number }> {
  const { ctx, riderId, now = new Date() } = params

  if (ctx.role !== 'STORE_MANAGER' && ctx.role !== 'ADMIN') {
    throw new ForbiddenError('Only a store manager may take cash from a rider')
  }
  if (!mongoose.isValidObjectId(riderId)) throw new ConflictError('Choose a rider')
  const orderIds = [...new Set(params.orderIds)].filter((id) => mongoose.isValidObjectId(id))
  if (orderIds.length === 0) throw new ConflictError('There is no cash to collect')

  const rider = new mongoose.Types.ObjectId(riderId)
  const filter = scoped(ctx, {
    _id: { $in: orderIds.map((id) => new mongoose.Types.ObjectId(id)) },
    ...pendingFilter([rider]),
  })

  const session = await mongoose.startSession()
  try {
    let result = { orders: 0, paise: 0 }
    await session.withTransaction(async () => {
      const mine = await Order.find(filter, null, { session })
        .select('status amountPaise delivery.amountCollectedPaise')
        .lean()
      if (mine.length === 0) throw new ConflictError('This cash has already been collected')

      const paise = mine.reduce((sum, o) => sum + cashOf(o), 0)
      for (const o of mine) {
        await Order.updateOne(
          { _id: o._id, 'delivery.codSettledAt': null },
          {
            $set: { 'delivery.codSettledAt': now, 'delivery.codSettledBy': ctx.userId },
            $push: {
              events: {
                fromStatus: o.status,
                toStatus: o.status,
                userId: ctx.userId,
                meta: {
                  action: 'COD_SETTLED',
                  riderId,
                  amountPaise: cashOf(o),
                  handoverPaise: paise,
                  handoverOrders: mine.length,
                },
                createdAt: now,
              },
            },
          },
          { session },
        )
      }
      result = { orders: mine.length, paise }
    })
    return result
  } finally {
    await session.endSession()
  }
}
