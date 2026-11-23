import mongoose from 'mongoose'
import { Order, Restaurant, User, type OrderDoc } from '../models'
import { ConflictError, ForbiddenError, NotFoundError, type AuthContext } from '../authContext'
import { ROLE_LABEL } from '../roles'
import { canCollectReturns, RTO_NOTE_MAX, type RtoStatus } from '../rto'
import { riderRecordOf, scoped } from './orderRepo'
import { orderSearchClause } from './orderSearch'
import { reasonLabel } from '../orderStatus'

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
  const me = await User.findOne({ _id: ctx.userId, tenantId: ctx.tenantId }).select('role canCollectReturns').lean()
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

  return (await Order.findOne({ _id, tenantId: ctx.tenantId }).lean<OrderDoc>())!
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

/**
 * One order's return as whoever reads it sees it, or null when there is none.
 * The riders named are the order's own tenant's staff, so its tenantId scopes
 * the lookup.
 */
export async function viewReturn(
  order: Pick<OrderDoc, 'delivery' | 'tenantId'>,
): Promise<ReturnView | null> {
  const rto = order.delivery?.rto
  if (!rto) return null
  // The rider who carried it, not everyone it was offered to.
  const riderIds = riderRecordOf(order)
  const ids = [...riderIds, rto.returnedBy].filter(
    (v): v is mongoose.Types.ObjectId => Boolean(v),
  )
  const users = ids.length > 0 ? await User.find({ _id: { $in: ids }, tenantId: order.tenantId }).select('name role').lean() : []
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
  /** Why it was not delivered, in words, when the order says. */
  failureReason: string | null
  /** The riders who carried it, as ids: the board groups by these. */
  riderIds: string[]
}

/** What the Bags coming back screen can narrow by. */
export type ReturnFilters = {
  riderId?: string | null
  outletId?: string | null
  /** CANCELLED (cancelled on the way) or FAILED (not delivered). */
  reason?: 'CANCELLED' | 'FAILED' | null
  q?: string | null
}

/**
 * The Mongo conditions for the filters, inside the caller's scope. A rider
 * is the one who took the bag (pickedUpBy), or, on orders from before that
 * was recorded, anyone it was assigned to.
 */
export async function returnFilterClause(ctx: AuthContext, f: ReturnFilters): Promise<Record<string, unknown>> {
  const and: Record<string, unknown>[] = []
  if (f.riderId && mongoose.isValidObjectId(f.riderId)) {
    const rid = new mongoose.Types.ObjectId(f.riderId)
    and.push({ $or: [{ 'delivery.pickedUpBy': rid }, { 'delivery.pickedUpBy': null, 'delivery.agentIds': rid }] })
  }
  if (f.outletId && mongoose.isValidObjectId(f.outletId)) and.push({ restaurantId: new mongoose.Types.ObjectId(f.outletId) })
  if (f.reason === 'CANCELLED') and.push({ 'delivery.rto.reason': 'CANCELLED' })
  // Not delivered, including returns opened as "missed delivery" before the status clean-up.
  if (f.reason === 'FAILED') and.push({ 'delivery.rto.reason': { $in: ['FAILED', 'MISSED_DELIVERY'] } })
  const search = f.q ? await orderSearchClause(ctx, f.q) : null
  if (search) and.push(search)
  return and.length ? { $and: and } : {}
}

/**
 * The riders with returns in this state, and how many each: the rider
 * dropdown, so the counter can pull up one rider's bags when they walk in.
 */
export async function returnRiders(ctx: AuthContext, status: RtoStatus): Promise<{ id: string; name: string; count: number }[]> {
  const orders = await Order.find(scoped(ctx, { 'delivery.rto.status': status }))
    .select('delivery.agentIds delivery.pickedUpBy')
    .sort({ 'delivery.rto.openedAt': -1 })
    .limit(3000)
    .lean()
  const counts = new Map<string, number>()
  for (const o of orders) for (const id of riderRecordOf(o)) counts.set(String(id), (counts.get(String(id)) ?? 0) + 1)
  if (counts.size === 0) return []
  const users = await User.find({ _id: { $in: [...counts.keys()] }, tenantId: ctx.tenantId }).select('name').lean()
  return users
    .map((u) => ({ id: String(u._id), name: u.name, count: counts.get(String(u._id)) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/**
 * Several bags back at once: a rider walks in with everything they could
 * not deliver. Each goes through the same rules as one at a time; the ones
 * that fail are reported, the rest are marked.
 */
export async function markManyReturned(ctx: AuthContext, orderIds: string[], note: string | null): Promise<{ marked: number; errors: string[] }> {
  await assertMayCollectReturns(ctx)
  let marked = 0
  const errors: string[] = []
  for (const orderId of orderIds.slice(0, 100)) {
    try {
      await markReturnedToOrigin({ ctx, orderId, note })
      marked++
    } catch (err) {
      if (errors.length < 3) errors.push(err instanceof Error ? err.message : 'Could not record one return.')
    }
  }
  return { marked, errors }
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
      .select('externalOrderId status trainNo contactName rawSeat restaurantId items amountPaise paymentMode delivery.agentIds delivery.pickedUpBy delivery.rto delivery.failureReason')
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
    userIds.length > 0 ? User.find({ _id: { $in: userIds }, tenantId: ctx.tenantId }).select('name').lean() : [],
    outletIds.length > 0 ? Restaurant.find({ _id: { $in: outletIds }, tenantId: ctx.tenantId }).select('name').lean() : [],
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
      failureReason: reasonLabel(o.delivery?.failureReason),
      riderIds: riderRecordOf(o).map(String),
    }
  })
  return { rows, total }
}

/** How many bags are still out, in the caller's scope. For badges. */
export async function countPendingReturns(ctx: AuthContext): Promise<number> {
  return Order.countDocuments(scoped(ctx, { 'delivery.rto.status': 'PENDING' }))
}
