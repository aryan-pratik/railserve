import mongoose from 'mongoose'
import { Order, Restaurant, User, type OrderDoc } from '../models'
import { ConflictError, ForbiddenError, NotFoundError, type AuthContext } from '../authContext'
import { ROLE_LABEL } from '../roles'
import { canCollectReturns, RTO_NOTE_MAX, type RtoStatus } from '../rto'
import { riderRecordOf, scoped } from './orderRepo'

/**
 * Return to origin: the bag that went out with a rider and is coming back.
 *
 * A return is opened by transitionOrder (never here) and closed here, once,
 * by whoever at the origin outlet takes the bag. Who that may be is the
 * admin's call, per store manager — see User.canCollectReturns and
 * lib/rto.ts. The outlet itself is enforced by the scope: a manager at
 * another station holding the order id gets a 404, exactly as everywhere else.
 */

function cleanNote(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim()
  if (!text) return null
  if (text.length > RTO_NOTE_MAX) throw new ConflictError(`Keep the note under ${RTO_NOTE_MAX} characters.`)
  return text
}

/**
 * May this caller collect returns? Read fresh from their staff record, not
 * from the session: an admin revoking the tick must take effect on the next
 * click, not the next login.
 */
export async function mayCollectReturns(ctx: AuthContext): Promise<boolean> {
  if (ctx.role === 'ADMIN') return true
  if (ctx.role !== 'STORE_MANAGER') return false
  const me = await User.findById(ctx.userId).select('role canCollectReturns').lean()
  return Boolean(me && canCollectReturns(me))
}

/** The same question, thrown with the reason when the answer is no. */
export async function assertMayCollectReturns(ctx: AuthContext): Promise<void> {
  if (await mayCollectReturns(ctx)) return
  if (ctx.role === 'DELIVERY_AGENT') {
    throw new ForbiddenError('A rider hands the order back; the outlet marks it returned.')
  }
  if (ctx.role === 'STORE_MANAGER') {
    throw new ForbiddenError(
      'You are not set up to collect returns. An admin can allow it on your staff record under Setup → Staff.',
    )
  }
  throw new ForbiddenError(`${ROLE_LABEL[ctx.role]}s do not collect returns; the outlet does.`)
}

/**
 * The origin outlet takes the bag back.
 *
 * Not a status change — the order stays CANCELLED, FAILED or whatever closed
 * it — so it does not belong in the transition allow-list; audited on the
 * event log like a cash handover. The PENDING precondition in the filter is
 * the concurrency guard: two people at the counter marking the same bag, the
 * second matches nothing and is told so.
 */
export async function markReturnedToOrigin(params: {
  ctx: AuthContext
  orderId: string
  note?: string | null
  now?: Date
}): Promise<OrderDoc> {
  const { ctx, orderId, now = new Date() } = params
  await assertMayCollectReturns(ctx)
  const note = cleanNote(params.note)

  if (!mongoose.isValidObjectId(orderId)) throw new NotFoundError('Order not found')
  const _id = new mongoose.Types.ObjectId(orderId)

  const current = await Order.findOne(scoped(ctx, { _id })).lean<OrderDoc>()
  if (!current) throw new NotFoundError('Order not found')
  const rto = current.delivery?.rto
  if (!rto) throw new ConflictError('This order has nothing to return: it never left the counter.')
  if (rto.status === 'RETURNED') {
    throw new ConflictError('This order has already been taken back. Reload to see who did it.')
  }

  const res = await Order.updateOne(
    scoped(ctx, { _id, 'delivery.rto.status': 'PENDING' }),
    {
      $set: {
        'delivery.rto.status': 'RETURNED',
        'delivery.rto.returnedAt': now,
        'delivery.rto.returnedBy': ctx.userId,
        'delivery.rto.note': note,
      },
      $push: {
        events: {
          fromStatus: current.status,
          toStatus: current.status,
          userId: ctx.userId,
          meta: {
            action: 'RTO_RETURNED',
            reason: rto.reason,
            riderIds: riderRecordOf(current),
            ...(note ? { note } : {}),
          },
          createdAt: now,
        },
      },
    },
  )
  if (res.matchedCount === 0) {
    throw new ConflictError('Someone else just took this order back. Reload to see it.')
  }

  return (await Order.findOne({ _id }).lean<OrderDoc>())!
}

export type ReturnView = {
  status: RtoStatus
  reason: string
  openedAt: string
  returnedAt: string | null
  returnedBy: string | null
  note: string | null
  /** The riders who carried it out, and so have to bring it back. */
  riders: string[]
}

/** One order's return as whoever reads it sees it, or null when there is none. */
export async function viewReturn(
  order: Pick<OrderDoc, 'delivery'>,
): Promise<ReturnView | null> {
  const rto = order.delivery?.rto
  if (!rto) return null
  // The rider who carried it, not everyone it was offered to.
  const riderIds = riderRecordOf(order)
  const ids = [...riderIds, rto.returnedBy].filter(
    (v): v is mongoose.Types.ObjectId => Boolean(v),
  )
  const users = ids.length > 0 ? await User.find({ _id: { $in: ids } }).select('name role').lean() : []
  const name = new Map(users.map((u) => [String(u._id), u.name]))
  const label = new Map(
    users.map((u) => [String(u._id), `${u.name} · ${ROLE_LABEL[u.role] ?? u.role}`]),
  )
  return {
    status: rto.status as RtoStatus,
    reason: rto.reason,
    openedAt: rto.openedAt.toISOString(),
    returnedAt: rto.returnedAt ? rto.returnedAt.toISOString() : null,
    returnedBy: rto.returnedBy ? (label.get(String(rto.returnedBy)) ?? 'Unknown user') : null,
    note: rto.note ?? null,
    riders: riderIds.map((id) => name.get(String(id)) ?? 'Unknown rider'),
  }
}

export type ReturnRow = {
  id: string
  externalOrderId: string
  status: string
  reason: string
  trainNo: string | null
  /** The passenger, so a bag on the counter can be matched to its bill. */
  contactName: string | null
  rawSeat: string | null
  outletName: string | null
  itemCount: number
  /** COD money that is not coming in with the bag, for the till to know. */
  codPaise: number | null
  riders: string[]
  openedAt: string
  returnedAt: string | null
  returnedBy: string | null
  note: string | null
}

/**
 * Returns in the caller's scope, one page at a time: waiting ones oldest
 * first, so the bag that has been out longest is at the top; collected ones
 * newest first, as a record.
 */
export async function listReturns(
  ctx: AuthContext,
  opts: {
    status: RtoStatus
    limit: number
    skip: number
    /** More conditions on the order, from the filter bar. Never widens the scope. */
    where?: Record<string, unknown>
  },
): Promise<{ rows: ReturnRow[]; total: number }> {
  const filter = scoped(ctx, { ...(opts.where ?? {}), 'delivery.rto.status': opts.status })
  const sort: Record<string, 1 | -1> =
    opts.status === 'PENDING' ? { 'delivery.rto.openedAt': 1 } : { 'delivery.rto.returnedAt': -1 }
  const [orders, total] = await Promise.all([
    Order.find(filter)
      .select('externalOrderId status trainNo contactName rawSeat restaurantId items amountPaise paymentMode delivery.agentIds delivery.pickedUpBy delivery.rto')
      .sort(sort)
      .skip(opts.skip)
      .limit(opts.limit)
      .lean(),
    Order.countDocuments(filter),
  ])
  if (orders.length === 0) return { rows: [], total }

  const userIds = orders.flatMap((o) => [...riderRecordOf(o), o.delivery?.rto?.returnedBy])
    .filter((v): v is mongoose.Types.ObjectId => Boolean(v))
  const outletIds = orders.map((o) => o.restaurantId).filter((v): v is mongoose.Types.ObjectId => Boolean(v))
  const [users, outlets] = await Promise.all([
    userIds.length > 0 ? User.find({ _id: { $in: userIds } }).select('name').lean() : [],
    outletIds.length > 0 ? Restaurant.find({ _id: { $in: outletIds } }).select('name').lean() : [],
  ])
  const userName = new Map(users.map((u) => [String(u._id), u.name]))
  const outletName = new Map(outlets.map((o) => [String(o._id), o.name]))

  const rows = orders.map((o) => {
    const rto = o.delivery!.rto!
    return {
      id: String(o._id),
      externalOrderId: o.externalOrderId,
      status: o.status,
      reason: rto.reason,
      trainNo: o.trainNo ?? null,
      contactName: o.contactName ?? null,
      rawSeat: o.rawSeat ?? null,
      outletName: o.restaurantId ? (outletName.get(String(o.restaurantId)) ?? null) : null,
      itemCount: (o.items ?? []).filter((i) => !i.isPacking).reduce((n, i) => n + i.qty, 0),
      codPaise: o.paymentMode === 'COD' ? (o.amountPaise ?? null) : null,
      riders: riderRecordOf(o).map((id) => userName.get(id) ?? 'Unknown rider'),
      openedAt: rto.openedAt.toISOString(),
      returnedAt: rto.returnedAt ? rto.returnedAt.toISOString() : null,
      returnedBy: rto.returnedBy ? (userName.get(String(rto.returnedBy)) ?? 'Unknown user') : null,
      note: rto.note ?? null,
    }
  })
  return { rows, total }
}

/** How many bags are still out, in the caller's scope. For badges. */
export async function countPendingReturns(ctx: AuthContext): Promise<number> {
  return Order.countDocuments(scoped(ctx, { 'delivery.rto.status': 'PENDING' }))
}
