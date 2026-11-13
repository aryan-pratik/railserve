import mongoose from 'mongoose'
import { Order, User } from '../models'
import { ConflictError, ForbiddenError, type AuthContext } from '../authContext'
import { COD_WALLET_FROM } from '../riderRecords'
import { canReceiveCash, receiverLabel } from '../collections'
import { outletScoped } from './orderRepo'

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

/**
 * Pending cash per rider, within the caller's outlets.
 *
 * Read through the outlet scope, not the rider scope: the filter already
 * names whose cash it is, and a team leader reads this for the riders under
 * them. Callers pass only rider ids the user may see.
 */
export async function pendingCashByRider(
  ctx: AuthContext,
  riderIds: (string | mongoose.Types.ObjectId)[],
): Promise<Map<string, PendingCash>> {
  const ids = riderIds.map((r) => new mongoose.Types.ObjectId(String(r)))
  const out = new Map<string, PendingCash>()
  if (ids.length === 0) return out

  const orders = await Order.find(outletScoped(ctx, pendingFilter(ids)))
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
  const latest = await Order.findOne(outletScoped(ctx, { ...holder, 'delivery.codSettledAt': { $ne: null } }))
    .sort({ 'delivery.codSettledAt': -1 })
    .select('delivery.codSettledAt')
    .lean()
  const at = latest?.delivery?.codSettledAt
  if (!at) return null

  const batch = await Order.find(outletScoped(ctx, { ...holder, 'delivery.codSettledAt': at }))
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

  if (!mongoose.isValidObjectId(riderId)) throw new ConflictError('Choose a rider')

  // Who may receive cash is an admin's decision per person (lib/collections),
  // so it is read off the user as they are now, not off the session's role.
  const receiver = await User.findById(ctx.userId).select('role isTeamLead canReceiveCash active').lean()
  if (!receiver || receiver.active === false || !canReceiveCash({ ...receiver, role: ctx.role })) {
    throw new ForbiddenError('You have not been authorised to receive cash from riders. Ask an admin.')
  }
  if (String(ctx.userId) === riderId) {
    throw new ForbiddenError('Somebody else has to receive your cash')
  }
  if (ctx.role === 'DELIVERY_AGENT') {
    // A team leader receives from their own team and nobody else.
    const member = await User.findOne({ _id: riderId, teamLeadId: ctx.userId }).select('_id').lean()
    if (!member) throw new ForbiddenError('That rider is not on your team')
  }
  const orderIds = [...new Set(params.orderIds)].filter((id) => mongoose.isValidObjectId(id))
  if (orderIds.length === 0) throw new ConflictError('There is no cash to collect')

  const rider = new mongoose.Types.ObjectId(riderId)
  const settlementId = new mongoose.Types.ObjectId().toString()
  const filter = outletScoped(ctx, {
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
            $set: {
              'delivery.codSettledAt': now,
              'delivery.codSettledBy': ctx.userId,
              'delivery.codSettlementId': settlementId,
            },
            $push: {
              events: {
                fromStatus: o.status,
                toStatus: o.status,
                userId: ctx.userId,
                meta: {
                  action: 'COD_SETTLED',
                  riderId,
                  settlementId,
                  receivedAs: receiverLabel({ role: ctx.role, isTeamLead: receiver.isTeamLead }),
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

/** One handover: cash a rider gave to somebody authorised to receive it. */
export type Collection = {
  id: string
  riderId: string
  at: string
  /** Who received it; null on handovers from before that was recorded. */
  receivedById: string | null
  orders: number
  paise: number
  orderIds: string[]
}

/**
 * A rider's (or several riders') collection history, newest first.
 *
 * Derived from the orders, like the wallet: each handover stamps every order
 * in it with the same time, receiver and id, so the batches read straight
 * back. Handovers made before the id existed group by rider and stamp, which
 * identifies them just as well since a handover writes one instant.
 *
 * `latestPerRider` returns one row per rider, their most recent handover.
 */
export async function collectionHistory(
  ctx: AuthContext,
  riderIds: (string | mongoose.Types.ObjectId)[],
  opts: { from?: Date; to?: Date; limit?: number; latestPerRider?: boolean } = {},
): Promise<Collection[]> {
  const ids = riderIds.map((r) => new mongoose.Types.ObjectId(String(r)))
  if (ids.length === 0) return []
  const at: Record<string, Date> = {}
  if (opts.from) at.$gte = opts.from
  if (opts.to) at.$lt = opts.to

  const rows = await Order.aggregate<{
    _id: { rider: mongoose.Types.ObjectId; at: Date; sid: string | null }
    by: mongoose.Types.ObjectId | null
    orders: number
    paise: number
    orderIds: mongoose.Types.ObjectId[]
  }>([
    {
      $match: outletScoped(ctx, {
        'delivery.codSettledAt': Object.keys(at).length ? at : { $ne: null },
        $or: [
          { 'delivery.collectedBy': { $in: ids } },
          { 'delivery.collectedBy': null, 'delivery.agentIds.0': { $in: ids } },
        ],
      }),
    },
    {
      $group: {
        _id: {
          rider: { $ifNull: ['$delivery.collectedBy', { $arrayElemAt: ['$delivery.agentIds', 0] }] },
          at: '$delivery.codSettledAt',
          sid: { $ifNull: ['$delivery.codSettlementId', null] },
        },
        by: { $first: '$delivery.codSettledBy' },
        orders: { $sum: 1 },
        paise: { $sum: { $ifNull: ['$delivery.amountCollectedPaise', { $ifNull: ['$amountPaise', 0] }] } },
        orderIds: { $push: '$_id' },
      },
    },
    { $sort: { '_id.at': -1 } },
    // One global limit would drop exactly the rider worth chasing: the one
    // whose last handover is older than everyone else's recent ones. For
    // "when did each last hand in", keep each rider's newest and no limit.
    ...(opts.latestPerRider
      ? [
          { $group: { _id: '$_id.rider', last: { $first: '$$ROOT' } } },
          { $replaceRoot: { newRoot: '$last' } },
          { $sort: { '_id.at': -1 as const } },
        ]
      : [{ $limit: opts.limit ?? 50 }]),
  ])
  return rows.map((r) => ({
    id: r._id.sid ?? `${r._id.rider}-${r._id.at.getTime()}`,
    riderId: String(r._id.rider),
    at: r._id.at.toISOString(),
    receivedById: r.by ? String(r.by) : null,
    orders: r.orders,
    paise: r.paise,
    orderIds: r.orderIds.map(String),
  }))
}

/** Names and standing of the people who received these collections. */
export async function receiversOf(
  collections: { receivedById: string | null }[],
): Promise<Map<string, { name: string; label: string }>> {
  const ids = [...new Set(collections.map((c) => c.receivedById).filter((x): x is string => Boolean(x)))]
  if (ids.length === 0) return new Map()
  const users = await User.find({ _id: { $in: ids } }).select('name role isTeamLead').lean()
  return new Map(users.map((u) => [String(u._id), { name: u.name, label: receiverLabel(u) }]))
}
