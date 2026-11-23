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

/** Only cash delivered inside [from, to). Open ends mean no limit on that side. */
export type DeliveredSpan = { from?: Date; to?: Date }

/**
 * Delivered, cash on delivery, not yet handed over — and held by one of
 * `riderIds`. `collectedBy` names the holder; orders closed before it existed
 * fall back to the first rider on the order, so a bulk handover to three
 * riders still counts its cash once.
 */
function pendingFilter(tenantId: mongoose.Types.ObjectId, riderIds: mongoose.Types.ObjectId[], span: DeliveredSpan = {}) {
  // A day is placed by when the order first closed, the same day the rider's
  // record and the board count it on. A delivery corrected the next morning
  // keeps its first close, so its cash and its debt stay on one day. Orders
  // from before closedAt existed fall back to their delivery time.
  const dayRange: Record<string, Date> = {}
  if (span.from) dayRange.$gte = span.from
  if (span.to) dayRange.$lt = span.to
  const byDay = Object.keys(dayRange).length
    ? [{ $or: [{ 'delivery.closedAt': dayRange }, { 'delivery.closedAt': null, 'delivery.deliveredAt': dayRange }] }]
    : []
  return {
    tenantId,
    status: 'DELIVERED' as const,
    paymentMode: 'COD' as const,
    'delivery.codSettledAt': null,
    // Cash from before the wallet started was settled by hand.
    'delivery.deliveredAt': { $gte: COD_WALLET_FROM },
    // Rating-order decoys are left out of money everywhere, here included.
    ratingOrder: { $ne: true },
    $and: [
      {
        $or: [
          { 'delivery.collectedBy': { $in: riderIds } },
          { 'delivery.collectedBy': null, 'delivery.agentIds.0': { $in: riderIds } },
        ],
      },
      ...byDay,
    ],
  }
}

/** Cash per order: what the rider recorded, or the bill when nobody recorded it. */
function cashOf(o: { amountPaise?: number | null; delivery?: { amountCollectedPaise?: number | null } | null }) {
  return o.delivery?.amountCollectedPaise ?? o.amountPaise ?? 0
}

/** What is still in the rider's hand for one order: its cash minus any part already handed in. */
function dueOf(o: { amountPaise?: number | null; delivery?: { amountCollectedPaise?: number | null; codPartPaidPaise?: number | null } | null }) {
  return Math.max(0, cashOf(o) - (o.delivery?.codPartPaidPaise ?? 0))
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
  span: DeliveredSpan = {},
): Promise<Map<string, PendingCash>> {
  const ids = riderIds.map((r) => new mongoose.Types.ObjectId(String(r)))
  const out = new Map<string, PendingCash>()
  if (ids.length === 0) return out

  const orders = await Order.find(outletScoped(ctx, pendingFilter(ctx.tenantId, ids, span)))
    .select('amountPaise delivery.amountCollectedPaise delivery.codPartPaidPaise delivery.collectedBy delivery.agentIds')
    .lean()

  for (const o of orders) {
    const holder = holderOf(o)
    const prev = out.get(holder) ?? { ...EMPTY, orderIds: [] }
    prev.paise += dueOf(o)
    prev.orders += 1
    prev.orderIds.push(String(o._id))
    out.set(holder, prev)
  }
  return out
}

/**
 * Every rider still holding cash from a delivery, whoever they are and
 * whatever day it was: the Riders board lists them even when they have since
 * been switched off, or their cash would drop out of every total.
 */
export async function ridersHoldingCash(ctx: AuthContext): Promise<string[]> {
  const rows = await Order.aggregate<{ _id: mongoose.Types.ObjectId | null }>([
    {
      $match: outletScoped(ctx, {
        tenantId: ctx.tenantId,
        status: 'DELIVERED',
        paymentMode: 'COD',
        'delivery.codSettledAt': null,
        'delivery.deliveredAt': { $gte: COD_WALLET_FROM },
        ratingOrder: { $ne: true },
      }),
    },
    { $group: { _id: { $ifNull: ['$delivery.collectedBy', { $arrayElemAt: ['$delivery.agentIds', 0] }] } } },
  ])
  return rows.map((r) => r._id).filter((v): v is mongoose.Types.ObjectId => Boolean(v)).map(String)
}

/** One delivered COD order whose cash a rider still holds. */
export type PendingCashOrder = {
  id: string
  riderId: string
  externalOrderId: string | null
  trainNo: string | null
  contactName: string | null
  /** Still due on this order. */
  paise: number
  /** Already handed in against this order by an earlier partial collection. */
  partPaidPaise: number
  deliveredAt: string | null
}

/**
 * The orders behind each rider's pending cash, oldest delivery first, so a
 * receiver can count and take them one at a time. Same filter and scope as
 * `pendingCashByRider`, so the rows always add up to its totals.
 */
export async function pendingCashOrders(
  ctx: AuthContext,
  riderIds: (string | mongoose.Types.ObjectId)[],
): Promise<PendingCashOrder[]> {
  const ids = riderIds.map((r) => new mongoose.Types.ObjectId(String(r)))
  if (ids.length === 0) return []
  const orders = await Order.find(outletScoped(ctx, pendingFilter(ctx.tenantId, ids)))
    .select('externalOrderId trainNo contactName amountPaise delivery.amountCollectedPaise delivery.codPartPaidPaise delivery.collectedBy delivery.agentIds delivery.deliveredAt')
    .sort({ 'delivery.deliveredAt': 1 })
    .lean()
  return orders.map((o) => ({
    id: String(o._id),
    riderId: holderOf(o),
    externalOrderId: o.externalOrderId ?? null,
    trainNo: o.trainNo ?? null,
    contactName: o.contactName ?? null,
    paise: dueOf(o),
    partPaidPaise: o.delivery?.codPartPaidPaise ?? 0,
    deliveredAt: o.delivery?.deliveredAt ? new Date(o.delivery.deliveredAt).toISOString() : null,
  }))
}

export async function pendingCashFor(ctx: AuthContext, riderId: mongoose.Types.ObjectId): Promise<PendingCash> {
  return (await pendingCashByRider(ctx, [riderId])).get(String(riderId)) ?? EMPTY
}

/** The rider's most recent handover, for "last handed over ₹X at 9:40". */
export async function lastSettlementFor(
  ctx: AuthContext,
  riderId: mongoose.Types.ObjectId,
): Promise<{ at: string; paise: number; orders: number } | null> {
  // The same records as the history, so a part payment reads as what was
  // actually handed in, not as the whole order.
  const [last] = await collectionHistory(ctx, [riderId], { limit: 1 })
  return last ? { at: last.at, paise: last.paise, orders: last.orders } : null
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
  /**
   * The cash actually received, in paise. Omitted means everything due on
   * the listed orders. Less than that is a partial collection: it clears the
   * oldest orders in full and records the remainder against the next one,
   * which stays in the rider's wallet for the balance.
   */
  paise?: number
  now?: Date
}): Promise<{ orders: number; paise: number; partial: { orderId: string; paidPaise: number; leftPaise: number } | null }> {
  const { ctx, riderId, now = new Date() } = params
  if (params.paise !== undefined && (!Number.isInteger(params.paise) || params.paise <= 0)) {
    throw new ConflictError('Enter the amount received, in whole rupees')
  }

  if (!mongoose.isValidObjectId(riderId)) throw new ConflictError('Choose a rider')

  // Who may receive cash is an admin's decision per person (lib/collections),
  // so it is read off the user as they are now, not off the session's role.
  const receiver = await User.findOne({ _id: ctx.userId, tenantId: ctx.tenantId }).select('role isTeamLead canReceiveCash active').lean()
  if (!receiver || receiver.active === false || !canReceiveCash({ ...receiver, role: ctx.role })) {
    throw new ForbiddenError('You have not been authorised to receive cash from riders. Ask an admin.')
  }
  if (String(ctx.userId) === riderId) {
    throw new ForbiddenError('Somebody else has to receive your cash')
  }
  if (ctx.role === 'DELIVERY_AGENT') {
    // A team leader receives from their own team and nobody else.
    const member = await User.findOne({ _id: riderId, teamLeadId: ctx.userId, tenantId: ctx.tenantId }).select('_id').lean()
    if (!member) throw new ForbiddenError('That rider is not on your team')
  }
  const orderIds = [...new Set(params.orderIds)].filter((id) => mongoose.isValidObjectId(id))
  if (orderIds.length === 0) throw new ConflictError('There is no cash to collect')

  const rider = new mongoose.Types.ObjectId(riderId)
  const settlementId = new mongoose.Types.ObjectId().toString()
  const filter = outletScoped(ctx, {
    _id: { $in: orderIds.map((id) => new mongoose.Types.ObjectId(id)) },
    ...pendingFilter(ctx.tenantId, [rider]),
  })

  const session = await mongoose.startSession()
  try {
    let result: { orders: number; paise: number; partial: { orderId: string; paidPaise: number; leftPaise: number } | null } = { orders: 0, paise: 0, partial: null }
    await session.withTransaction(async () => {
      const mine = await Order.find(filter, null, { session })
        .select('status amountPaise delivery.amountCollectedPaise delivery.codPartPaidPaise delivery.deliveredAt')
        .sort({ 'delivery.deliveredAt': 1 })
        .lean()
      if (mine.length === 0) throw new ConflictError('This cash has already been collected')

      const dueTotal = mine.reduce((sum, o) => sum + dueOf(o), 0)
      const received = params.paise ?? dueTotal
      if (received > dueTotal) throw new ConflictError(`Only ₹${(dueTotal / 100).toFixed(0)} is due; enter that or less`)
      const receivedAs = receiverLabel({ role: ctx.role, isTeamLead: receiver.isTeamLead })

      // Oldest delivery first: whole orders clear while the cash lasts, and
      // whatever is left lands on the next one as a part payment.
      let carry = received
      let settled = 0
      let partial: { orderId: string; paidPaise: number; leftPaise: number } | null = null
      for (const o of mine) {
        if (carry <= 0) break
        const due = dueOf(o)
        const event = (action: 'COD_SETTLED' | 'COD_PART_PAID', amountPaise: number) => ({
          fromStatus: o.status,
          toStatus: o.status,
          userId: ctx.userId,
          meta: { action, riderId, settlementId, receivedAs, amountPaise, handoverPaise: received, handoverOrders: mine.length },
          createdAt: now,
        })
        if (carry >= due) {
          await Order.updateOne(
            { _id: o._id, tenantId: ctx.tenantId, 'delivery.codSettledAt': null },
            {
              $set: { 'delivery.codSettledAt': now, 'delivery.codSettledBy': ctx.userId, 'delivery.codSettlementId': settlementId },
              $push: { events: event('COD_SETTLED', due) },
            },
            { session },
          )
          carry -= due
          settled += 1
        } else {
          await Order.updateOne(
            { _id: o._id, tenantId: ctx.tenantId, 'delivery.codSettledAt': null },
            { $inc: { 'delivery.codPartPaidPaise': carry }, $push: { events: event('COD_PART_PAID', carry) } },
            { session },
          )
          partial = { orderId: String(o._id), paidPaise: carry, leftPaise: due - carry }
          carry = 0
        }
      }
      result = { orders: settled, paise: received, partial }
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

  const idStrings = ids.map(String)
  const holder = { $ifNull: ['$delivery.collectedBy', { $arrayElemAt: ['$delivery.agentIds', 0] }] }
  const ACTIONS = ['COD_SETTLED', 'COD_PART_PAID']
  type Row = { _id: { rider: string; at: Date; sid: string | null }; by: mongoose.Types.ObjectId | null; paise: number; orderIds: mongoose.Types.ObjectId[] }
  // Newest first, then one per rider or the first N, inside each pipeline so
  // neither returns more than the page needs.
  const tail = (riderKey: string) =>
    opts.latestPerRider
      ? [{ $sort: { '_id.at': -1 as const } }, { $group: { _id: riderKey, last: { $first: '$$ROOT' } } }, { $replaceRoot: { newRoot: '$last' } }]
      : [{ $sort: { '_id.at': -1 as const } }, { $limit: opts.limit ?? 50 }]

  const [recorded, legacy] = await Promise.all([
    // Handovers read from the records on each order's event log, not from
    // the orders' totals: a handover can pay part of an order (COD_PART_PAID)
    // and finish it another day, and only the record says how much changed
    // hands when. A record without the amount (older) was a whole order.
    Order.aggregate<Row>([
      {
        $match: outletScoped(ctx, {
          tenantId: ctx.tenantId,
          'events.meta.action': { $in: ACTIONS },
          $or: [{ 'delivery.collectedBy': { $in: ids } }, { 'delivery.agentIds': { $in: ids } }],
        }),
      },
      { $unwind: '$events' },
      { $match: { 'events.meta.action': { $in: ACTIONS }, ...(Object.keys(at).length ? { 'events.createdAt': at } : {}) } },
      {
        $addFields: {
          _rider: { $ifNull: ['$events.meta.riderId', { $toString: holder }] },
          _paise: { $ifNull: ['$events.meta.amountPaise', { $ifNull: ['$delivery.amountCollectedPaise', { $ifNull: ['$amountPaise', 0] }] }] },
        },
      },
      { $match: { _rider: { $in: idStrings } } },
      {
        $group: {
          _id: { rider: '$_rider', at: '$events.createdAt', sid: { $ifNull: ['$events.meta.settlementId', null] } },
          by: { $first: '$events.userId' },
          paise: { $sum: '$_paise' },
          orderIds: { $addToSet: '$_id' },
        },
      },
      ...tail('$_id.rider'),
    ]),
    // Orders settled with no record on their log (marked by hand, or from
    // before the records): the whole order's cash, as before.
    Order.aggregate<Row>([
      {
        $match: outletScoped(ctx, {
          tenantId: ctx.tenantId,
          'delivery.codSettledAt': Object.keys(at).length ? at : { $ne: null },
          'events.meta.action': { $nin: ACTIONS },
          $or: [
            { 'delivery.collectedBy': { $in: ids } },
            { 'delivery.collectedBy': null, 'delivery.agentIds.0': { $in: ids } },
          ],
        }),
      },
      {
        $group: {
          _id: { rider: { $toString: holder }, at: '$delivery.codSettledAt', sid: { $ifNull: ['$delivery.codSettlementId', null] } },
          by: { $first: '$delivery.codSettledBy' },
          paise: { $sum: { $ifNull: ['$delivery.amountCollectedPaise', { $ifNull: ['$amountPaise', 0] }] } },
          orderIds: { $push: '$_id' },
        },
      },
      ...tail('$_id.rider'),
    ]),
  ])

  // One list, newest first; one per rider when that is what was asked.
  let rows = [...recorded, ...legacy].sort((a, b) => b._id.at.getTime() - a._id.at.getTime())
  if (opts.latestPerRider) {
    const seen = new Set<string>()
    rows = rows.filter((r) => (seen.has(r._id.rider) ? false : (seen.add(r._id.rider), true)))
  } else {
    rows = rows.slice(0, opts.limit ?? 50)
  }
  return rows.map((r) => ({
    id: r._id.sid ?? `${r._id.rider}-${r._id.at.getTime()}`,
    riderId: String(r._id.rider),
    at: r._id.at.toISOString(),
    receivedById: r.by ? String(r.by) : null,
    orders: r.orderIds.length,
    paise: r.paise,
    orderIds: r.orderIds.map(String),
  }))
}

/** Names and standing of the people who received these collections. */
export async function receiversOf(
  ctx: AuthContext,
  collections: { receivedById: string | null }[],
): Promise<Map<string, { name: string; label: string }>> {
  const ids = [...new Set(collections.map((c) => c.receivedById).filter((x): x is string => Boolean(x)))]
  if (ids.length === 0) return new Map()
  const users = await User.find({ _id: { $in: ids }, tenantId: ctx.tenantId }).select('name role isTeamLead').lean()
  return new Map(users.map((u) => [String(u._id), { name: u.name, label: receiverLabel(u) }]))
}
