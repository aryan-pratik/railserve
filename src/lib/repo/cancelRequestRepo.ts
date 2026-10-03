import mongoose from 'mongoose'
import { Order, User, type OrderDoc } from '../models'
import { ConflictError, ForbiddenError, NotFoundError, type AuthContext } from '../authContext'
import {
  canDecideCancellation,
  canRequestCancellation,
  ORDER_STATUSES,
  TERMINAL_STATUSES,
  type OrderStatus,
} from '../orderStatus'
import { ROLE_LABEL } from '../roles'
import { findById, scoped } from './orderRepo'
import { transitionOrder } from './transitionOrder'

/**
 * A store manager's request to cancel an order, and the call desk's answer.
 *
 * The manager never cancels: they ask, with a reason, and a telecaller or an
 * admin accepts (which cancels through transitionOrder like any other cancel)
 * or refuses. The request lives on `order.cancelRequest`; each step is also
 * pushed to the event log as a side-effect event, the same shape assignAgents
 * uses, so the order's history reads in one place.
 */

export const CANCEL_REASON_MAX = 500

/** Statuses a request can be raised from. Derived, so it follows TRANSITIONS. */
const REQUESTABLE = ORDER_STATUSES.filter((s) => canRequestCancellation('STORE_MANAGER', s))

function cleanReason(raw: string, required: boolean, what: string): string | null {
  const text = raw.trim()
  if (!text) {
    if (required) throw new Error(`Say briefly ${what}.`)
    return null
  }
  if (text.length < 3 && required) throw new Error(`Say briefly ${what}.`)
  if (text.length > CANCEL_REASON_MAX) {
    throw new Error(`Keep it under ${CANCEL_REASON_MAX} characters.`)
  }
  return text
}

export async function requestCancellation(
  ctx: AuthContext,
  orderId: string,
  reasonRaw: string,
): Promise<void> {
  if (ctx.role !== 'STORE_MANAGER') {
    throw new ForbiddenError('Only a store manager asks for a cancellation: you can cancel directly.')
  }
  const reason = cleanReason(reasonRaw, true, 'why this order should be cancelled')!
  const order = await findById(ctx, orderId)
  if (!order) throw new NotFoundError('Order not found')
  if (order.cancelRequest?.status === 'PENDING') {
    throw new ConflictError('A cancellation has already been asked for: it is waiting for an answer.')
  }
  if (!REQUESTABLE.includes(order.status as OrderStatus)) {
    throw new ConflictError(`An order that is ${order.status} can no longer be cancelled.`)
  }

  const now = new Date()
  // The status read above and "not already pending" are both in the filter,
  // so two taps on the button cannot raise two requests, and an order that
  // moved on in between is refused rather than asked about.
  const res = await Order.updateOne(
    scoped(ctx, {
      _id: order._id,
      status: order.status,
      'cancelRequest.status': { $ne: 'PENDING' },
    }),
    {
      $set: {
        cancelRequest: {
          status: 'PENDING',
          reason,
          requestedBy: ctx.userId,
          requestedAt: now,
          decidedBy: null,
          decidedAt: null,
          decisionNote: null,
        },
      },
      $push: { events: sideEvent(ctx, order.status, 'CANCEL_REQUESTED', reason, now) },
    },
  )
  if (res.matchedCount === 0) {
    throw new ConflictError('This order changed underneath you. Reload and try again.')
  }
}

/**
 * Accepts the pending request: the order is cancelled through transitionOrder,
 * so the allow-list, the scope and the concurrency guard all apply exactly as
 * for a telecaller's own cancel, and the kitchen's cancellation alert fires the
 * same way. The cancel event carries the manager's reason.
 */
export async function approveCancellation(ctx: AuthContext, orderId: string): Promise<void> {
  if (!canDecideCancellation(ctx.role)) {
    throw new ForbiddenError('Only a telecaller or an admin can answer a cancellation request.')
  }
  const order = await findById(ctx, orderId)
  if (!order) throw new NotFoundError('Order not found')
  const req = order.cancelRequest
  if (!req || req.status !== 'PENDING') {
    throw new ConflictError('There is no cancellation request waiting on this order.')
  }

  await transitionOrder({
    ctx,
    orderId,
    to: 'CANCELLED',
    meta: {
      via: 'cancel-request',
      reason: req.reason,
      requestedBy: String(req.requestedBy),
    },
  })

  // After the cancel, not before: if the cancel is refused (the order moved on
  // underneath us) the request is still pending, which is the truth. The
  // status filter keeps a concurrent refusal from being overwritten.
  await Order.updateOne(
    { _id: order._id, 'cancelRequest.status': 'PENDING' },
    {
      $set: {
        'cancelRequest.status': 'APPROVED',
        'cancelRequest.decidedBy': ctx.userId,
        'cancelRequest.decidedAt': new Date(),
      },
    },
  )
}

export async function refuseCancellation(
  ctx: AuthContext,
  orderId: string,
  noteRaw: string,
): Promise<void> {
  if (!canDecideCancellation(ctx.role)) {
    throw new ForbiddenError('Only a telecaller or an admin can answer a cancellation request.')
  }
  const note = cleanReason(noteRaw, false, 'why')
  const order = await findById(ctx, orderId)
  if (!order) throw new NotFoundError('Order not found')
  if (order.cancelRequest?.status !== 'PENDING') {
    throw new ConflictError('There is no cancellation request waiting on this order.')
  }

  const now = new Date()
  const res = await Order.updateOne(
    scoped(ctx, { _id: order._id, status: order.status, 'cancelRequest.status': 'PENDING' }),
    {
      $set: {
        'cancelRequest.status': 'REFUSED',
        'cancelRequest.decidedBy': ctx.userId,
        'cancelRequest.decidedAt': now,
        'cancelRequest.decisionNote': note,
      },
      $push: { events: sideEvent(ctx, order.status, 'CANCEL_REFUSED', note, now) },
    },
  )
  if (res.matchedCount === 0) {
    throw new ConflictError('This request was answered or the order changed. Reload to see it.')
  }
}

/** A side-effect event, the same shape assignAgents writes: status unchanged. */
function sideEvent(
  ctx: AuthContext,
  status: string,
  action: string,
  reason: string | null,
  at: Date,
) {
  return {
    fromStatus: status,
    toStatus: status,
    userId: ctx.userId,
    meta: reason ? { action, reason } : { action },
    createdAt: at,
  }
}

/** What a request looks like to whoever reads it. */
export type CancelRequestView = {
  status: 'PENDING' | 'APPROVED' | 'REFUSED'
  reason: string
  requestedBy: string
  requestedAt: string
  decidedBy: string | null
  decidedAt: string | null
  decisionNote: string | null
}

/** Resolves the names on one order's request, or null when there is none. */
export async function viewCancelRequest(
  order: Pick<OrderDoc, 'cancelRequest'>,
): Promise<CancelRequestView | null> {
  const req = order.cancelRequest
  if (!req) return null
  const ids = [req.requestedBy, req.decidedBy].filter(
    (v): v is mongoose.Types.ObjectId => Boolean(v),
  )
  const users = await User.find({ _id: { $in: ids } }).select('name role').lean()
  const label = new Map(
    users.map((u) => [String(u._id), `${u.name} · ${ROLE_LABEL[u.role] ?? u.role}`]),
  )
  return {
    status: req.status as CancelRequestView['status'],
    reason: req.reason,
    requestedBy: label.get(String(req.requestedBy)) ?? 'Unknown user',
    requestedAt: req.requestedAt.toISOString(),
    decidedBy: req.decidedBy ? (label.get(String(req.decidedBy)) ?? 'Unknown user') : null,
    decidedAt: req.decidedAt ? req.decidedAt.toISOString() : null,
    decisionNote: req.decisionNote ?? null,
  }
}

export type PendingCancelRequest = {
  id: string
  externalOrderId: string
  trainNo: string | null
  rawSeat: string | null
  status: string
  reason: string
  requestedBy: string
  requestedAt: string
}

/**
 * Every request still waiting for an answer, oldest first, in the caller's
 * scope. An order that has ended some other way meanwhile (the passenger
 * cancelled on the phone, the rider delivered it) has nothing left to decide,
 * so it drops off here even though its request was never answered.
 */
export async function listPendingCancelRequests(
  ctx: AuthContext,
  opts: { limit?: number } = {},
): Promise<PendingCancelRequest[]> {
  const rows = await Order.find(
    scoped(ctx, {
      'cancelRequest.status': 'PENDING',
      status: { $nin: TERMINAL_STATUSES },
    }),
  )
    .select('externalOrderId trainNo rawSeat status cancelRequest')
    .sort({ 'cancelRequest.requestedAt': 1 })
    .limit(opts.limit ?? 50)
    .lean()
  if (rows.length === 0) return []

  const users = await User.find({ _id: { $in: rows.map((r) => r.cancelRequest!.requestedBy) } })
    .select('name')
    .lean()
  const name = new Map(users.map((u) => [String(u._id), u.name]))

  return rows.map((r) => ({
    id: String(r._id),
    externalOrderId: r.externalOrderId,
    trainNo: r.trainNo ?? null,
    rawSeat: r.rawSeat ?? null,
    status: r.status,
    reason: r.cancelRequest!.reason,
    requestedBy: name.get(String(r.cancelRequest!.requestedBy)) ?? 'Unknown user',
    requestedAt: r.cancelRequest!.requestedAt.toISOString(),
  }))
}
