import mongoose from 'mongoose'
import { Order, User, type OrderDoc } from '../models'
import {
  ORDER_STATUSES,
  isTerminal,
  isTransitionAllowed,
  missingQuoteFields,
  TRANSITIONS,
  type OrderStatus,
} from '../orderStatus'
import { ConflictError, ForbiddenError, NotFoundError, type AuthContext } from '../authContext'
import { scoped } from './orderRepo'
import { closedAtOf, correctableUntil, isRiderOutcome, type RiderOutcome } from '../riderRecords'
import { opensReturn } from '../rto'

/**
 * Fields a transition is permitted to write alongside the status change.
 * Deliberately a closed list: this function must not become a general-purpose
 * update backdoor, or "status is only written here" stops meaning anything.
 */
export type TransitionApply = {
  proofType?: 'OTP' | 'PHOTO' | 'SIGNATURE'
  proofValue?: string
  amountCollectedPaise?: number
  failureReason?: string
}

/** Timestamps that are a direct consequence of entering a status. */
const TIMESTAMP_ON_ENTER: Partial<Record<OrderStatus, string>> = {
  DISPATCHED: 'delivery.dispatchedAt',
  DELIVERED: 'delivery.deliveredAt',
}

/**
 * Statuses only a rider can reach, and therefore the ones that record who the
 * rider was.
 *
 * `delivery.agentIds` is filled in ahead of time when a telecaller, store
 * manager or admin assigns the order, and that assignment is what lets the
 * rider see it at all (see scopeFilter in orderRepo). Writing the actor here
 * as well keeps the array honest when it was never assigned — a manager
 * handing food over the counter names the rider — and $addToSet means an
 * assigned rider is not written twice.
 */
const RECORDS_THE_RIDER: OrderStatus[] = ['DISPATCHED', 'DELIVERED', 'FAILED']

/**
 * THE ONLY PLACE `status` IS EVER WRITTEN. Plan §4.
 *
 * - Opens a session and transaction
 * - Re-reads the order inside the transaction, through the caller's scope
 * - Validates the edge against the allow-list, and the caller's role against it
 * - Enforces the QUOTED -> RECEIVED completeness guard
 * - Updates status and pushes the event in one updateOne, filtered on the
 *   expected `from` status so a concurrent writer loses instead of silently
 *   overwriting (plan §4 concurrency, §13.8)
 */
export async function transitionOrder(params: {
  ctx: AuthContext
  orderId: string
  to: OrderStatus
  meta?: Record<string, unknown>
  apply?: TransitionApply
  /**
   * The rider who physically took the food, when the caller is not that rider.
   *
   * A store manager may mark an order on its way on a rider's behalf; without
   * this the record would name the manager, and "who has my food" is the one
   * question this array exists to answer. Callers must verify the id belongs to
   * an active DELIVERY_AGENT before passing it — see markRunOnTheWay.
   */
  handedTo?: mongoose.Types.ObjectId
}): Promise<OrderDoc> {
  const { ctx, orderId, to, meta = {}, apply = {}, handedTo } = params

  if (!mongoose.isValidObjectId(orderId)) {
    throw new NotFoundError('Order not found')
  }
  const _id = new mongoose.Types.ObjectId(orderId)

  const session = await mongoose.startSession()
  try {
    let updated: OrderDoc | null = null

    await session.withTransaction(async () => {
      // Re-read inside the transaction, and through the caller's scope: a
      // store manager holding another outlet's order id gets a 404 here, not
      // a permission error that would confirm the order exists.
      const current = await Order.findOne(scoped(ctx, { _id }), null, { session }).lean<OrderDoc>()
      if (!current) throw new NotFoundError('Order not found')

      const from = current.status as OrderStatus

      // Already in the target status. This is the common shape of a lost race:
      // MongoDB raises a write conflict on the concurrent update, withTransaction
      // retries the callback, and by then the winner has committed. Without this
      // branch it would fall through to the allow-list and be reported as an
      // illegal PREPARED -> PREPARED edge, which reads as a bug rather than as
      // what it is — somebody else got there first.
      if (from === to) {
        throw new ConflictError(
          `Order is already ${to}. Someone else may have just done this: reload.`,
        )
      }

      const roles = TRANSITIONS[from]?.[to]
      if (!roles) {
        throw new ForbiddenError(
          `Illegal transition ${from} -> ${to}. ` +
            `Allowed from ${from}: ${Object.keys(TRANSITIONS[from] ?? {}).join(', ') || '(terminal)'}`,
        )
      }
      if (!isTransitionAllowed(from, to, ctx.role)) {
        throw new ForbiddenError(
          `${ctx.role} may not perform ${from} -> ${to} (allowed: ${roles.join(', ')})`,
        )
      }

      // A status that records a carrier must actually record one. Only a rider
      // is themselves the carrier; anyone else — today, a store manager handing
      // food over the counter — has to name who took it. Without this the order
      // could reach DISPATCHED with delivery.agentIds empty, and "who has my
      // food" would have no answer at exactly the moment it gets asked.
      //
      // A telecaller is the exception: closing an order out from what the
      // passenger said on the phone is not a handover, so there is nobody new
      // to name. Whoever already carries it stays on delivery.agentIds.
      if (
        RECORDS_THE_RIDER.includes(to) &&
        ctx.role !== 'DELIVERY_AGENT' &&
        ctx.role !== 'TELECALLER' &&
        !handedTo
      ) {
        throw new ForbiddenError(
          `${ctx.role} must name the rider taking this order (${from} -> ${to})`,
        )
      }

      // Completeness guard — enforced here, never in the UI.
      if (from === 'QUOTED' && to === 'RECEIVED') {
        const missing = missingQuoteFields(current as unknown as Record<string, unknown>)
        if (missing.length > 0) {
          throw new ConflictError(
            `Cannot confirm order: missing required field(s) ${missing.join(', ')}`,
          )
        }
      }

      const $set: Record<string, unknown> = { status: to }
      for (const [k, v] of Object.entries(apply)) {
        if (v !== undefined) $set[`delivery.${k}`] = v
      }
      const stamp = TIMESTAMP_ON_ENTER[to]
      if (stamp) $set[stamp] = new Date()

      // dispatchedAt / deliveredAt above already carry the timing; assignedAt
      // belongs to the admin override path and is left alone here.
      //
      // A rider acting for themselves is recorded automatically; anyone else
      // has to say who took it, and is never recorded as the rider themselves.
      const rider = RECORDS_THE_RIDER.includes(to)
        ? ctx.role === 'DELIVERY_AGENT'
          ? ctx.userId
          : handedTo
        : undefined
      const $addToSet = rider ? { 'delivery.agentIds': rider } : undefined

      // The bag has one carrier. Whoever takes it off the counter holds it
      // from here, whoever else it was offered to (see onRiderRecord).
      if (to === 'DISPATCHED' && rider) $set['delivery.pickedUpBy'] = rider
      // Back on the counter: nobody is carrying it.
      if (from === 'DISPATCHED' && to === 'PREPARED') {
        $set['delivery.pickedUpBy'] = null
        // And it has not left the counter: an order cancelled while it sits
        // there again was in nobody's hands, and is nobody's work.
        $set['delivery.dispatchedAt'] = null
      }
      // A rider closing an order nobody is recorded as carrying (taken over
      // from another rider mid-run, or closed straight off the counter) is
      // the one who had it. Named here so a closed order is one rider's.
      if (isTerminal(to) && ctx.role === 'DELIVERY_AGENT' && !current.delivery?.pickedUpBy) {
        $set['delivery.pickedUpBy'] = ctx.userId
      }

      // First close only: corrections and the passenger-number mask are
      // measured from here, so nothing after the first close may move it.
      if (isTerminal(to) && !current.delivery?.closedAt) $set['delivery.closedAt'] = new Date()

      // Whoever is holding the cash. A telecaller closing it from the phone
      // hands nothing over, so the first rider already on it keeps the cash.
      if (to === 'DELIVERED') {
        Object.assign($set, deliveredFields(current, rider ?? null, apply.amountCollectedPaise))
      }

      // Food that left the counter and is not being delivered has to come
      // back to it. Opened on the status change itself, never by hand, so no
      // cancel or failure of an order in a rider's hands can slip past
      // without a return for the origin outlet to collect (see lib/rto.ts).
      if (opensReturn(from, to)) $set['delivery.rto'] = openReturn(to)

      // A rider putting back an order they took off the counter themselves
      // gives it back to the counter, not just the status: left on agentIds
      // they would still hold it, and no other rider could take it. An order
      // the office assigned (assignedAt set) stays theirs.
      const $pull =
        from === 'DISPATCHED' &&
        to === 'PREPARED' &&
        ctx.role === 'DELIVERY_AGENT' &&
        !current.delivery?.assignedAt
          ? { 'delivery.agentIds': ctx.userId }
          : undefined

      // The status precondition is the concurrency guard. Two managers hitting
      // "Mark Prepared" at once: the second matches zero documents.
      const res = await Order.updateOne(
        scoped(ctx, { _id, status: from }),
        {
          $set,
          ...($addToSet ? { $addToSet } : {}),
          ...($pull ? { $pull } : {}),
          $push: {
            events: {
              fromStatus: from,
              toStatus: to,
              userId: ctx.userId,
              // Who took the bag, when it was not the person tapping: the
              // only place a counter handover names its rider in the log.
              meta: handedTo && rider ? { ...meta, riderId: String(rider) } : meta,
              createdAt: new Date(),
            },
          },
        },
        { session },
      )

      if (res.matchedCount === 0) {
        throw new ConflictError(
          `Order changed underneath you: it is no longer ${from}. Reload and retry.`,
        )
      }

      updated = await Order.findOne({ _id }, null, { session }).lean<OrderDoc>()
    })

    return updated!
  } finally {
    await session.endSession()
  }
}

/**
 * What entering DELIVERED writes besides the status, wherever it is entered
 * from: the pipeline, a rider's correction or an admin's override. One copy,
 * so a delivery means the same thing however it was recorded.
 *
 * The cash holder is the rider who delivered it; failing that the rider who
 * picked it up; failing that the only rider on the order. With several riders
 * offered an order nobody picked up, the first is charged, as before — a
 * telecaller closing an order nobody tapped has no better answer.
 *
 * The cash amount is fixed here, once. A COD order with nothing typed is
 * taken to have been paid in full, and that figure is stored rather than left
 * to be read off the bill later: a bill edited after the delivery must not
 * quietly change what a rider owes for cash they already collected.
 */
function deliveredFields(
  current: OrderDoc,
  rider: mongoose.Types.ObjectId | null,
  amountCollectedPaise: number | undefined,
): Record<string, unknown> {
  const holder = rider ?? current.delivery?.pickedUpBy ?? current.delivery?.agentIds?.[0] ?? null
  const fields: Record<string, unknown> = { 'delivery.collectedBy': holder }
  // The rider charged with the cash is the rider whose delivery it is. An
  // order closed without a pickup would otherwise sit on the record of
  // everyone it was offered to.
  if (holder && !current.delivery?.pickedUpBy) fields['delivery.pickedUpBy'] = holder
  if (amountCollectedPaise === undefined && current.delivery?.amountCollectedPaise == null) {
    fields['delivery.amountCollectedPaise'] =
      current.paymentMode === 'COD' ? (current.amountPaise ?? null) : null
  }
  return fields
}

/**
 * Admin-only escape hatch: sets status to any value, including one that has
 * never existed before, bypassing the guards that say WHO may make a move —
 * the TRANSITIONS allow-list, the rider-naming check and the quote
 * completeness guard. Those keep the guided pipeline honest; they do not
 * apply to an admin correction or a custom label.
 *
 * What it does not bypass is what a status MEANS. Overriding to a fixed
 * status writes what the pipeline would have written (close time, delivery
 * time, cash holder, a return for a bag that was out), and two moves are
 * refused outright because they would contradict a record somebody else
 * made: marking delivered an order the outlet already took back, and
 * un-delivering an order whose cash has already been received.
 *
 * Still transactional, still re-reads under the caller's scope, and still
 * uses the freshly-read status as the optimistic-concurrency precondition —
 * only the validation in between is smaller. The audit event is tagged
 * `via: 'admin-override'` so it stays conspicuous in the event log.
 *
 * A custom status takes an order off every fixed-list check elsewhere in the
 * app (LIVE_STATUSES, the status tabs, TRANSITIONS) — by design: it is now
 * off the recognized pipeline, not a bug.
 */
export async function adminOverrideStatus(params: {
  ctx: AuthContext
  orderId: string
  to: string
  meta?: Record<string, unknown>
}): Promise<OrderDoc> {
  const { ctx, orderId, to, meta = {} } = params

  if (ctx.role !== 'ADMIN') {
    throw new ForbiddenError('Only an admin may set a custom order status')
  }
  if (!mongoose.isValidObjectId(orderId)) {
    throw new NotFoundError('Order not found')
  }
  const _id = new mongoose.Types.ObjectId(orderId)

  const session = await mongoose.startSession()
  try {
    let updated: OrderDoc | null = null

    await session.withTransaction(async () => {
      const current = await Order.findOne(scoped(ctx, { _id }), null, { session }).lean<OrderDoc>()
      if (!current) throw new NotFoundError('Order not found')

      const from = current.status

      if (from === to) {
        throw new ConflictError(
          `Order is already ${to}. Someone else may have just done this: reload.`,
        )
      }

      // A fixed status means the same thing however it is reached. The
      // override skips who-may-do-what, not what the status does: an order
      // overridden to DELIVERED has a delivery time and a cash holder, one
      // cancelled out of a rider's hands has a bag to bring back, and none of
      // them may contradict what the counter or the cash already recorded.
      const $set: Record<string, unknown> = { status: to }
      const consequences: Record<string, unknown> = {}
      const now = new Date()
      const known = (ORDER_STATUSES as readonly string[]).includes(to)
      const rto = current.delivery?.rto ?? null

      if (to === 'DELIVERED' && rto?.status === 'RETURNED') {
        throw new ConflictError(
          'The outlet has already taken this order back as a return, so it cannot be marked delivered',
        )
      }
      if (from === 'DELIVERED' && current.delivery?.codSettledAt && current.paymentMode === 'COD') {
        throw new ConflictError(
          'The cash for this delivery has already been received from the rider, so it cannot stop being a delivery',
        )
      }

      if (known && isTerminal(to as OrderStatus) && !current.delivery?.closedAt) {
        $set['delivery.closedAt'] = now
      }
      if (to === 'DELIVERED') {
        $set['delivery.deliveredAt'] = current.delivery?.deliveredAt ?? now
        $set['delivery.failureReason'] = null
        Object.assign($set, deliveredFields(current, null, undefined))
        // Delivered after all: there is nothing left to bring back.
        if (rto) {
          $set['delivery.rto'] = null
          consequences.returnWithdrawn = true
        }
      } else if (from === 'DELIVERED') {
        // No longer a delivery, so no cash changed hands on it.
        $set['delivery.deliveredAt'] = null
        $set['delivery.amountCollectedPaise'] = null
        $set['delivery.collectedBy'] = null
        consequences.cashCleared = true
      }
      const wasClosed = (ORDER_STATUSES as readonly string[]).includes(from) && isTerminal(from as OrderStatus)
      const reopens = known && !isTerminal(to as OrderStatus)
      if (wasClosed && reopens) {
        // Back in play. The next close is a new close, on its own day, and
        // the old return no longer describes where the bag is.
        $set['delivery.closedAt'] = null
        $set['delivery.deliveredAt'] = null
        $set['delivery.failureReason'] = null
        if (rto) {
          $set['delivery.rto'] = null
          consequences.returnWithdrawn = true
        }
      }
      if (from === 'DISPATCHED' && reopens) {
        // Back at the outlet: nobody is carrying it, and every rider it was
        // offered to can take it again.
        $set['delivery.pickedUpBy'] = null
        $set['delivery.dispatchedAt'] = null
      }
      if (to === 'DISPATCHED') {
        $set['delivery.dispatchedAt'] = (wasClosed ? null : current.delivery?.dispatchedAt) ?? now
        // One rider on it is its carrier. With several the override cannot
        // know which, and whoever closes it is recorded then.
        const agents = current.delivery?.agentIds ?? []
        if (!current.delivery?.pickedUpBy && agents.length === 1) $set['delivery.pickedUpBy'] = agents[0]
      }
      const stillHasReturn = rto && !(wasClosed && reopens)
      if (known && !stillHasReturn && from === 'DISPATCHED' && opensReturn('DISPATCHED', to as OrderStatus)) {
        $set['delivery.rto'] = openReturn(to as OrderStatus, now)
        consequences.returnOpened = true
      }

      const res = await Order.updateOne(
        scoped(ctx, { _id, status: from }),
        {
          $set,
          $push: {
            events: {
              fromStatus: from,
              toStatus: to,
              userId: ctx.userId,
              meta: { ...meta, ...consequences, via: 'admin-override' },
              createdAt: new Date(),
            },
          },
        },
        { session },
      )

      if (res.matchedCount === 0) {
        throw new ConflictError(
          `Order changed underneath you: it is no longer ${from}. Reload and retry.`,
        )
      }

      updated = await Order.findOne({ _id }, null, { session }).lean<OrderDoc>()
    })

    return updated!
  } finally {
    await session.endSession()
  }
}

/**
 * A telecaller flagging an order as a decoy run purely to prompt an app-store
 * rating. Like `adminOverrideStatus` this bypasses TRANSITIONS — RATING_ORDER
 * is not a pipeline step reachable from a fixed set of source statuses, see
 * `canFlagRatingOrder` in orderStatus.ts — as well as the rider-naming check
 * and the quote guard. Unlike `adminOverrideStatus` the target is fixed and
 * the role is fixed, so there is no free-text risk to police. The audit event
 * is tagged `via: 'telecaller-rating-flag'`.
 *
 * Only an admin can move an order back out of RATING_ORDER if one is flagged
 * by mistake, via the existing free-text `adminOverrideStatus` tool.
 */
export async function flagRatingOrder(params: {
  ctx: AuthContext
  orderId: string
  meta?: Record<string, unknown>
}): Promise<OrderDoc> {
  const { ctx, orderId, meta = {} } = params
  const to = 'RATING_ORDER'

  if (ctx.role !== 'TELECALLER') {
    throw new ForbiddenError('Only a telecaller may flag a rating order')
  }
  if (!mongoose.isValidObjectId(orderId)) {
    throw new NotFoundError('Order not found')
  }
  const _id = new mongoose.Types.ObjectId(orderId)

  const session = await mongoose.startSession()
  try {
    let updated: OrderDoc | null = null

    await session.withTransaction(async () => {
      const current = await Order.findOne(scoped(ctx, { _id }), null, { session }).lean<OrderDoc>()
      if (!current) throw new NotFoundError('Order not found')

      const from = current.status

      if (from === to) {
        throw new ConflictError(
          `Order is already ${to}. Someone else may have just done this: reload.`,
        )
      }

      const res = await Order.updateOne(
        scoped(ctx, { _id, status: from }),
        {
          $set: { status: to },
          $push: {
            events: {
              fromStatus: from,
              toStatus: to,
              userId: ctx.userId,
              meta: { ...meta, via: 'telecaller-rating-flag' },
              createdAt: new Date(),
            },
          },
        },
        { session },
      )

      if (res.matchedCount === 0) {
        throw new ConflictError(
          `Order changed underneath you: it is no longer ${from}. Reload and retry.`,
        )
      }

      updated = await Order.findOne({ _id }, null, { session }).lean<OrderDoc>()
    })

    return updated!
  } finally {
    await session.endSession()
  }
}

/**
 * A rider correcting how one of their own finished orders ended: delivered,
 * not delivered, or cancelled. Taps on a platform get made in a hurry, and the
 * rider is the one who knows which it really was.
 *
 * Outside TRANSITIONS on purpose, like flagRatingOrder: the allow-list
 * describes the pipeline, and its terminal states have no way out. This is a
 * correction of the record, bounded by rules the allow-list cannot express:
 *
 * - only the rider on the order, and only within 30 hours of its first close
 * - never once a store manager has taken that order's cash — the money has
 *   changed hands, and a flip now would leave the handover wrong
 * - never out of an office cancellation: a cancel the rider did not make is
 *   not theirs to undo
 * - never *into* CANCELLED: that status means the office stopped the order.
 *   A rider saying "cancelled" (the passenger refused it at the door) is the
 *   rider failing to deliver, and is recorded as FAILED with their reason.
 *   Older app builds still offer the word, so it is mapped here rather than
 *   refused, or their queued correction would be dropped.
 *
 * `from` is the status the rider saw when they tapped. The app queues this
 * offline, and a correction replayed after someone else changed the order must
 * lose rather than silently overwrite them.
 */
export async function correctRiderOutcome(params: {
  ctx: AuthContext
  orderId: string
  from: RiderOutcome
  to: RiderOutcome
  reason?: string | null
  receivedBy?: string | null
  meta?: Record<string, unknown>
  now?: Date
}): Promise<OrderDoc> {
  const { ctx, orderId, from, meta = {}, now = new Date() } = params
  const to: RiderOutcome = params.to === 'CANCELLED' ? 'FAILED' : params.to
  const reason = params.reason?.trim() || null
  const receivedBy = params.receivedBy?.trim() || null

  if (ctx.role !== 'DELIVERY_AGENT') {
    throw new ForbiddenError('Only the rider on an order may correct how it ended')
  }
  if (!isRiderOutcome(from) || !isRiderOutcome(params.to) || from === to) {
    throw new ConflictError(
      params.to !== to
        ? 'A rider records a cancellation as not delivered, which this order already is'
        : 'Choose a different outcome',
    )
  }
  if (to !== 'DELIVERED' && !reason) {
    throw new ConflictError('Say why it was not delivered')
  }
  if (!mongoose.isValidObjectId(orderId)) throw new NotFoundError('Order not found')
  const _id = new mongoose.Types.ObjectId(orderId)

  const session = await mongoose.startSession()
  try {
    let updated: OrderDoc | null = null

    await session.withTransaction(async () => {
      const current = await Order.findOne(scoped(ctx, { _id }), null, { session }).lean<OrderDoc>()
      if (!current) throw new NotFoundError('Order not found')

      if (current.status === to) {
        throw new ConflictError(`Order is already ${to}. Reload.`)
      }
      if (current.status !== from) {
        throw new ConflictError(`Order changed underneath you: it is now ${current.status}. Reload.`)
      }

      const closedAt = closedAtOf(current)
      if (!correctableUntil(closedAt, now)) {
        throw new ForbiddenError('This order closed more than 30 hours ago and can no longer be changed')
      }
      if (current.delivery?.codSettledAt) {
        throw new ForbiddenError('The cash for this order has been handed over, so it can no longer be changed')
      }
      if (from === 'CANCELLED' && !wasCancelledBy(current, ctx.userId)) {
        throw new ForbiddenError('The office cancelled this order, so only the office can change it')
      }
      // A rider corrects their own tap, not somebody else's finding. When a
      // telecaller recorded "not delivered" from the passenger's own word,
      // the rider saying "delivered" a day later is a dispute, not a
      // correction, and it would silently withdraw the return the outlet is
      // waiting on. That goes to the office.
      if (!wasClosedBy(current, ctx.userId)) {
        throw new ForbiddenError(
          'The office recorded how this order ended, so only the office can change it',
        )
      }

      // The store has the bag back: it cannot now have been delivered as
      // well. The rider has to take the correction to the counter instead.
      if (to === 'DELIVERED' && current.delivery?.rto?.status === 'RETURNED') {
        throw new ForbiddenError(
          'The store has already taken this order back, so it cannot be marked delivered',
        )
      }

      const $set: Record<string, unknown> = { status: to }
      if (!current.delivery?.closedAt && closedAt) $set['delivery.closedAt'] = closedAt
      if (to === 'DELIVERED') {
        // Delivered after all: there is nothing to bring back.
        if (current.delivery?.rto) $set['delivery.rto'] = null
        $set['delivery.deliveredAt'] = now
        $set['delivery.failureReason'] = null
        $set['delivery.collectedBy'] = ctx.userId
        if (!current.delivery?.pickedUpBy) $set['delivery.pickedUpBy'] = ctx.userId
        $set['delivery.amountCollectedPaise'] =
          current.paymentMode === 'COD' ? (current.amountPaise ?? null) : null
        if (receivedBy) {
          $set['delivery.proofType'] = 'SIGNATURE'
          $set['delivery.proofValue'] = receivedBy
        }
      } else {
        // Nothing was handed over, so there is no cash, no receiver and no
        // delivery time to keep.
        $set['delivery.deliveredAt'] = null
        $set['delivery.failureReason'] = reason
        $set['delivery.amountCollectedPaise'] = null
        $set['delivery.collectedBy'] = null
        $set['delivery.proofType'] = null
        $set['delivery.proofValue'] = null
        // "Delivered" turning out to be "not delivered" means the rider still
        // has the bag, so it has to come back. A return already open stays as
        // it is: the bag was always coming back, only the reason changed.
        if (from === 'DELIVERED' && !current.delivery?.rto) $set['delivery.rto'] = openReturn(to, now)
      }

      const res = await Order.updateOne(
        scoped(ctx, { _id, status: from }),
        {
          $set,
          $push: {
            events: {
              fromStatus: from,
              toStatus: to,
              userId: ctx.userId,
              meta: {
                ...meta,
                via: 'rider-correction',
                reason,
                receivedBy,
                // What the rider actually tapped, when it was not the status written.
                ...(params.to !== to ? { requestedOutcome: params.to } : {}),
              },
              createdAt: now,
            },
          },
        },
        { session },
      )
      if (res.matchedCount === 0) {
        throw new ConflictError(`Order changed underneath you: it is no longer ${from}. Reload and retry.`)
      }

      updated = await Order.findOne({ _id }, null, { session }).lean<OrderDoc>()
    })

    return updated!
  } finally {
    await session.endSession()
  }
}

/** A fresh return to origin, waiting for the outlet to take the bag back. */
function openReturn(reason: OrderStatus, at: Date = new Date()) {
  return { status: 'PENDING', openedAt: at, reason, returnedAt: null, returnedBy: null, note: null }
}

/**
 * True when the order's current outcome was recorded by this rider: the last
 * event that changed its status is theirs. Orders with no such event (data
 * from before the log) are given the benefit of the doubt.
 */
export function wasClosedBy(
  order: {
    events?: { fromStatus?: string | null; toStatus?: string | null; userId?: unknown }[] | null
  },
  riderId: mongoose.Types.ObjectId,
): boolean {
  const last = [...(order.events ?? [])].reverse().find((e) => e.toStatus && e.fromStatus !== e.toStatus)
  if (!last || !last.userId) return true
  return String(last.userId) === String(riderId)
}

/** True when the order's latest move into CANCELLED was this rider's own correction. */
export function wasCancelledBy(
  order: { events?: { toStatus?: string | null; userId?: unknown; meta?: unknown }[] | null },
  riderId: mongoose.Types.ObjectId,
): boolean {
  const last = [...(order.events ?? [])].reverse().find((e) => e.toStatus === 'CANCELLED')
  const via = (last?.meta as { via?: string } | null | undefined)?.via
  return Boolean(last && via === 'rider-correction' && String(last.userId) === String(riderId))
}

/**
 * Assigns delivery agents. Not a status change, so it does not belong in the
 * transition allow-list — but it is still audited onto the event log because
 * "who was this handed to, and when" is a question that gets asked after a
 * failed delivery.
 */
export async function assignAgents(params: {
  ctx: AuthContext
  orderId: string
  agentIds: string[]
}): Promise<OrderDoc> {
  const { ctx, orderId, agentIds } = params

  if (ctx.role !== 'ADMIN') {
    throw new ForbiddenError('Only an admin may assign delivery agents')
  }
  if (!mongoose.isValidObjectId(orderId)) throw new NotFoundError('Order not found')

  const _id = new mongoose.Types.ObjectId(orderId)
  const ids = agentIds.map((a) => new mongoose.Types.ObjectId(a))

  const session = await mongoose.startSession()
  try {
    let updated: OrderDoc | null = null
    await session.withTransaction(async () => {
      const current = await Order.findOne(scoped(ctx, { _id }), null, { session }).lean<OrderDoc>()
      if (!current) throw new NotFoundError('Order not found')

      const open = !isTerminal(current.status as OrderStatus)
      // An open order is still routing: a rider from another outlet would be
      // named on it and never shown it (see assignRiders). A closed order is
      // only a record, and the record may name whoever really carried it.
      if (open && ids.length > 0) {
        const atOutlet = await User.countDocuments(
          { _id: { $in: ids }, role: 'DELIVERY_AGENT', restaurantIds: current.restaurantId },
          { session },
        )
        if (atOutlet !== ids.length) {
          throw new ConflictError(
            'One of those riders does not work at this order\'s outlet, so they would not see it. Add the outlet to the rider in Setup first.',
          )
        }
      }

      // The record now says who carried it. With one rider named that is
      // unambiguous, and on a delivery whose cash is still out the cash moves
      // with the correction; otherwise the carrier is only dropped when the
      // correction removes them.
      const carrier = current.delivery?.pickedUpBy
      const carried = current.status === 'DISPATCHED' || !open
      const $carrier: Record<string, unknown> = {}
      if (carried && ids.length === 1) {
        $carrier['delivery.pickedUpBy'] = ids[0]
        if (current.status === 'DELIVERED' && !current.delivery?.codSettledAt) {
          $carrier['delivery.collectedBy'] = ids[0]
        }
      } else if (carrier && !ids.some((i) => i.equals(String(carrier)))) {
        $carrier['delivery.pickedUpBy'] = null
      }

      await Order.updateOne(
        { _id },
        {
          $set: {
            'delivery.agentIds': ids,
            'delivery.assignedAt': ids.length > 0 ? new Date() : null,
            ...$carrier,
          },
          $push: {
            events: {
              fromStatus: current.status,
              toStatus: current.status,
              userId: ctx.userId,
              meta: {
                action: 'ASSIGN_AGENTS',
                fromAgentIds: (current.delivery?.agentIds ?? []).map(String),
                agentIds: agentIds,
              },
              createdAt: new Date(),
            },
          },
        },
        { session },
      )
      updated = await Order.findOne({ _id }, null, { session }).lean<OrderDoc>()
    })
    return updated!
  } finally {
    await session.endSession()
  }
}

/**
 * The office assigns riders to one order: a telecaller, store manager or admin
 * picks who will carry it, and it then shows up in that rider's app.
 *
 * Unlike `assignAgents` (an admin's correction of the record), this is live
 * routing, so it is stricter: the order must still be open, and every rider
 * must be active. A telecaller or manager may only pick riders who work at the
 * order's outlet; an admin may pick anyone. An empty list takes the order off
 * every rider.
 *
 * It is not a status change. A rider taking an order is still their own tap.
 */
export async function assignRiders(params: {
  ctx: AuthContext
  orderId: string
  riderIds: string[]
}): Promise<OrderDoc> {
  const { ctx, orderId, riderIds } = params

  if (ctx.role !== 'ADMIN' && ctx.role !== 'TELECALLER' && ctx.role !== 'STORE_MANAGER') {
    throw new ForbiddenError('Only the office may assign riders')
  }
  if (!mongoose.isValidObjectId(orderId)) throw new NotFoundError('Order not found')
  const unique = [...new Set(riderIds)]
  if (!unique.every((r) => mongoose.isValidObjectId(r))) {
    throw new ConflictError('Choose a rider from the list')
  }

  const _id = new mongoose.Types.ObjectId(orderId)
  const ids = unique.map((r) => new mongoose.Types.ObjectId(r))

  const session = await mongoose.startSession()
  try {
    let updated: OrderDoc | null = null
    await session.withTransaction(async () => {
      const current = await Order.findOne(scoped(ctx, { _id }), null, { session }).lean<OrderDoc>()
      if (!current) throw new NotFoundError('Order not found')
      if (isTerminal(current.status as OrderStatus)) {
        throw new ConflictError('This order is closed, so a rider cannot be assigned')
      }

      if (ids.length > 0) {
        const riders = await User.find(
          {
            _id: { $in: ids },
            role: 'DELIVERY_AGENT',
            active: true,
            // For an admin as well. A rider only ever sees orders at their
            // own outlets (scopeFilter), so a rider assigned from another
            // outlet is named on the order and never shown it: the order
            // looks assigned in the office and is missing in the app.
            restaurantIds: current.restaurantId,
          },
          '_id',
          { session },
        ).lean()
        if (riders.length !== ids.length) {
          throw new ConflictError(
            'One of those riders is not active at this outlet. Add the outlet to the rider in Setup first, or they will not see the order.',
          )
        }
      }

      // Taking an order off the rider who is carrying it is a handover. Given
      // to one rider, that rider has it now. Given to several, there is no
      // pickup left to tap on an order already out, so the carrier is
      // recorded when one of them closes it (see transitionOrder).
      const carrier = current.delivery?.pickedUpBy
      const carrierRemoved = Boolean(carrier) && !ids.some((i) => i.equals(String(carrier)))
      const nextCarrier = current.status === 'DISPATCHED' && ids.length === 1 ? ids[0] : null

      await Order.updateOne(
        { _id },
        {
          $set: {
            'delivery.agentIds': ids,
            'delivery.assignedAt': ids.length > 0 ? new Date() : null,
            ...(carrierRemoved ? { 'delivery.pickedUpBy': nextCarrier } : {}),
          },
          $push: {
            events: {
              fromStatus: current.status,
              toStatus: current.status,
              userId: ctx.userId,
              meta: {
                action: 'ASSIGN_RIDERS',
                agentIds: unique,
                fromAgentIds: (current.delivery?.agentIds ?? []).map(String),
                ...(carrierRemoved ? { takenFrom: String(carrier) } : {}),
              },
              createdAt: new Date(),
            },
          },
        },
        { session },
      )
      updated = await Order.findOne({ _id }, null, { session }).lean<OrderDoc>()
    })
    return updated!
  } finally {
    await session.endSession()
  }
}

/** Active riders an office user may pick for an order: those at its outlet. */
export async function listAssignableRiders(
  restaurantId: mongoose.Types.ObjectId | null | undefined,
): Promise<{ id: string; name: string; phone: string }[]> {
  // An enquiry has no outlet yet, so there is no one to pick.
  if (!restaurantId) return []
  const riders = await User.find({ role: 'DELIVERY_AGENT', active: true, restaurantIds: restaurantId })
    .select('name phone')
    .sort({ name: 1 })
    .lean()
  return riders.map((r) => ({ id: String(r._id), name: r.name, phone: r.phone }))
}
