import mongoose from 'mongoose'
import { Order, type OrderDoc } from '../models'
import {
  isTransitionAllowed,
  missingQuoteFields,
  TRANSITIONS,
  type OrderStatus,
} from '../orderStatus'
import { ConflictError, ForbiddenError, NotFoundError, type AuthContext } from '../authContext'
import { scoped } from './orderRepo'

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
 * `delivery.agentIds` used to be filled in ahead of time by an admin assigning
 * a run. Nothing assigns now — a rider takes whatever is ready at their kitchen
 * — so the array means "who actually handled this" and is written here, as a
 * consequence of the transition itself. Doing it here rather than at the call
 * site means it cannot be forgotten by a new caller, and $addToSet keeps it
 * honest when two riders split a large bulk handover.
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
}): Promise<OrderDoc> {
  const { ctx, orderId, to, meta = {}, apply = {} } = params

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
          `Order is already ${to}. Someone else may have just done this — reload.`,
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
      const $addToSet =
        ctx.role === 'DELIVERY_AGENT' && RECORDS_THE_RIDER.includes(to)
          ? { 'delivery.agentIds': ctx.userId }
          : undefined

      // The status precondition is the concurrency guard. Two managers hitting
      // "Mark Prepared" at once: the second matches zero documents.
      const res = await Order.updateOne(
        scoped(ctx, { _id, status: from }),
        {
          $set,
          ...($addToSet ? { $addToSet } : {}),
          $push: {
            events: {
              fromStatus: from,
              toStatus: to,
              userId: ctx.userId,
              meta,
              createdAt: new Date(),
            },
          },
        },
        { session },
      )

      if (res.matchedCount === 0) {
        throw new ConflictError(
          `Order changed underneath you — it is no longer ${from}. Reload and retry.`,
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

      await Order.updateOne(
        { _id },
        {
          $set: {
            'delivery.agentIds': ids,
            'delivery.assignedAt': ids.length > 0 ? new Date() : null,
          },
          $push: {
            events: {
              fromStatus: current.status,
              toStatus: current.status,
              userId: ctx.userId,
              meta: { action: 'ASSIGN_AGENTS', agentIds: agentIds },
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
