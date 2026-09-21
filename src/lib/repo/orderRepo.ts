import mongoose, { type QueryFilter } from 'mongoose'
import { Order, Counter, User, type OrderDoc } from '../models'
import { type AuthContext, ForbiddenError, NotFoundError } from '../authContext'
import { ROLE_LABEL } from '../roles'
import type { CallNoteView } from '../callNotes'

/**
 * THE ONLY PLACE Order.find / findOne / aggregate MAY BE CALLED.
 *
 * Plan §2: MongoDB has no row-level security, so store isolation is purely a
 * discipline problem in application code. The discipline is this file plus the
 * ESLint rule that fails the build on direct model access anywhere else.
 *
 * Every read is filtered by the caller's context before it reaches Mongo, so a
 * forgotten `.where()` at a call site cannot leak another outlet's orders —
 * call sites are not given the opportunity to forget.
 */

/**
 * Builds the mandatory filter for a caller.
 *
 * - ADMIN sees everything.
 * - STORE_MANAGER sees every outlet they hold, and nothing else.
 * - DELIVERY_AGENT sees every outlet they are attached to, and nothing else.
 * - TELECALLER sees every outlet they are attached to, and nothing else.
 *
 * Riders used to be scoped by assignment — `delivery.agentIds` contained who
 * was *going* to deliver. Nothing assigns that any more: a rider picks up
 * whatever is ready at their kitchen, and the system records who actually
 * delivered afterwards. Scoping by assignment would now match nothing at all,
 * so riders are scoped by outlet exactly as managers are, and station isolation
 * is preserved by the same mechanism rather than by a second one.
 *
 * Holding no outlets is a data error, not an admin — returning an impossible
 * filter is the safe reading for all three scoped roles.
 */
function scopeFilter(ctx: AuthContext): QueryFilter<OrderDoc> {
  switch (ctx.role) {
    case 'ADMIN':
      return {}
    case 'STORE_MANAGER':
    case 'DELIVERY_AGENT':
    case 'TELECALLER':
      return ctx.restaurantIds.length > 0
        ? { restaurantId: { $in: ctx.restaurantIds } }
        : { _id: { $exists: false } }
  }
}

/** Merge the caller's scope with a caller-supplied filter. */
export function scoped(ctx: AuthContext, filter: QueryFilter<OrderDoc> = {}): QueryFilter<OrderDoc> {
  const scope = scopeFilter(ctx)
  if (Object.keys(scope).length === 0) return filter
  if (Object.keys(filter).length === 0) return scope
  return { $and: [scope, filter] }
}

export async function findMany(
  ctx: AuthContext,
  filter: QueryFilter<OrderDoc> = {},
  opts: { sort?: Record<string, 1 | -1>; limit?: number; skip?: number } = {},
) {
  return Order.find(scoped(ctx, filter))
    .sort(opts.sort ?? { createdAt: -1 })
    .skip(opts.skip ?? 0)
    .limit(opts.limit ?? 200)
    .lean()
}

/**
 * Fetch one order by id, within scope.
 *
 * Returns null rather than throwing when the order exists but belongs to
 * someone else — callers turn that into a 404. A 403 would confirm the order
 * exists, which is itself a cross-tenant leak.
 */
export async function findById(ctx: AuthContext, id: string) {
  if (!mongoose.isValidObjectId(id)) return null
  return Order.findOne(scoped(ctx, { _id: new mongoose.Types.ObjectId(id) })).lean()
}

export async function findByIdOrThrow(ctx: AuthContext, id: string) {
  const order = await findById(ctx, id)
  if (!order) throw new NotFoundError('Order not found')
  return order
}

/** Scoped count. For a tab badge, where loading the rows themselves is waste. */
export async function countOrders(ctx: AuthContext, filter: QueryFilter<OrderDoc> = {}) {
  return Order.countDocuments(scoped(ctx, filter))
}

export async function countByStatus(ctx: AuthContext, filter: QueryFilter<OrderDoc> = {}) {
  const rows = await Order.aggregate([
    { $match: scoped(ctx, filter) },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ])
  return Object.fromEntries(rows.map((r) => [r._id as string, r.count as number]))
}

/**
 * Orders cancelled recently, for the live cancellation alert (see
 * /api/store/cancellations).
 *
 * A cancellation is the one status change that nobody downstream goes looking
 * for: the order simply drops out of LIVE_STATUSES and vanishes off the
 * kitchen board, so a manager mid-cook sees a card disappear at best and
 * nothing at all at worst. This feeds a banner that says it out loud instead.
 *
 * The moment of cancellation is read off the event log, not `updatedAt` —
 * updatedAt moves on any later edit, which would keep re-raising an alert
 * that was already dealt with. Scoped like every other read, so a manager is
 * only ever told about their own outlets' orders.
 */
export type CancellationAlert = {
  id: string
  externalOrderId: string
  trainNo: string | null
  coach: string | null
  berth: string | null
  rawSeat: string | null
  contactName: string | null
  stationCode: string
  /** ISO — when the cancelling event was recorded. */
  cancelledAt: string
  /** Who cancelled it, resolved to a name. 'System' when there was no actor. */
  by: string
  reason: string | null
}

export async function recentCancellations(
  ctx: AuthContext,
  opts: { serviceDate: string; since: Date; limit?: number },
): Promise<CancellationAlert[]> {
  const rows = await Order.aggregate<{
    _id: mongoose.Types.ObjectId
    externalOrderId: string
    trainNo: string | null
    coach: string | null
    berth: string | null
    rawSeat: string | null
    contactName: string | null
    stationCode: string
    cancelEvent: {
      createdAt: Date
      userId: mongoose.Types.ObjectId | null
      meta: Record<string, unknown> | null
    } | null
  }>([
    // Hits the store_dashboard index (restaurantId, serviceDate, status).
    { $match: scoped(ctx, { status: 'CANCELLED', serviceDate: opts.serviceDate }) },
    {
      $addFields: {
        // $arrayElemAt with -1 rather than $last: same result, and it does not
        // require a Mongo new enough to have $last.
        cancelEvent: {
          $arrayElemAt: [
            {
              $filter: {
                input: '$events',
                as: 'e',
                cond: { $eq: ['$$e.toStatus', 'CANCELLED'] },
              },
            },
            -1,
          ],
        },
      },
    },
    { $match: { 'cancelEvent.createdAt': { $gte: opts.since } } },
    { $sort: { 'cancelEvent.createdAt': -1 } },
    { $limit: opts.limit ?? 20 },
    {
      $project: {
        externalOrderId: 1, trainNo: 1, coach: 1, berth: 1, rawSeat: 1,
        contactName: 1, stationCode: 1, cancelEvent: 1,
      },
    },
  ])

  if (rows.length === 0) return []

  // Only reached when something actually was cancelled, so the common case
  // costs one aggregation and no user lookup at all.
  const actorIds = rows
    .map((r) => r.cancelEvent?.userId)
    .filter((v): v is mongoose.Types.ObjectId => Boolean(v))
  const actors = actorIds.length
    ? await User.find({ _id: { $in: actorIds } }).select('name').lean()
    : []
  const actorName = new Map(actors.map((a) => [String(a._id), a.name]))

  return rows.map((r) => {
    const meta = (r.cancelEvent?.meta ?? {}) as Record<string, unknown>
    const reason = typeof meta.reason === 'string' && meta.reason.trim() ? meta.reason.trim() : null
    return {
      id: String(r._id),
      externalOrderId: r.externalOrderId,
      trainNo: r.trainNo ?? null,
      coach: r.coach ?? null,
      berth: r.berth ?? null,
      rawSeat: r.rawSeat ?? null,
      contactName: r.contactName ?? null,
      stationCode: r.stationCode,
      cancelledAt: (r.cancelEvent?.createdAt ?? new Date()).toISOString(),
      by: r.cancelEvent?.userId ? (actorName.get(String(r.cancelEvent.userId)) ?? 'Unknown user') : 'System',
      reason,
    }
  })
}

/**
 * Order counts per payment mode, for the filter tabs on /admin/orders.
 *
 * Aggregated rather than counted four times so the tab row costs one round
 * trip, and grouped on the same scoped match as every other read — a count
 * that leaked across outlets would tell a manager how much business the
 * kitchen next door is doing.
 *
 * Orders with no payment mode land under the `null` key, so the caller can
 * still reconcile the tabs against the unfiltered total.
 */
export async function countByPaymentMode(ctx: AuthContext, filter: QueryFilter<OrderDoc> = {}) {
  const rows = await Order.aggregate([
    { $match: scoped(ctx, filter) },
    { $group: { _id: '$paymentMode', count: { $sum: 1 } } },
  ])
  return Object.fromEntries(rows.map((r) => [String(r._id), r.count as number]))
}

/** Distinct restaurant ids present in scope — used to build filter dropdowns. */
export async function findRestaurantIdsInScope(ctx: AuthContext) {
  return Order.distinct('restaurantId', scoped(ctx))
}

/**
 * Distinct status values present in scope, including any custom ones an
 * admin has set via adminOverrideStatus — used to build the status filter and
 * the status edit dropdown on /admin/orders.
 */
export async function distinctStatuses(ctx: AuthContext): Promise<string[]> {
  return Order.distinct('status', scoped(ctx))
}

/**
 * Scoped field update for the quote flow.
 *
 * Ordinary fields only — `status` is deliberately not writable here, so
 * transitionOrder keeps its monopoly on it. Scoped like every other write, so
 * this cannot be pointed at another outlet's order.
 */
export async function updateOrderFields(
  ctx: AuthContext,
  orderId: string,
  fields: Record<string, unknown>,
): Promise<boolean> {
  if (!mongoose.isValidObjectId(orderId)) return false
  if ('status' in fields || 'events' in fields || 'callLog' in fields) {
    // callLog joins the list so "append-only" is true at the boundary rather
    // than by convention — without it, { callLog: [] } here is a one-line log
    // wipe available to any admin action.
    throw new Error('status and events are written only by transitionOrder; callLog only by appendCallNote')
  }
  const res = await Order.updateOne(
    scoped(ctx, { _id: new mongoose.Types.ObjectId(orderId) }),
    { $set: fields },
  )
  return res.matchedCount > 0
}

/**
 * Permanently removes an order document. Unlike every status transition
 * here, this has no undo and takes the order's embedded event log with it —
 * there is no separate audit trail. Scoped like every other write, so a
 * store manager (were this ever exposed to one) could not reach another
 * outlet's order.
 */
export async function deleteOrder(ctx: AuthContext, orderId: string): Promise<boolean> {
  if (!mongoose.isValidObjectId(orderId)) return false
  const res = await Order.deleteOne(scoped(ctx, { _id: new mongoose.Types.ObjectId(orderId) }))
  return res.deletedCount > 0
}

/** Scoped update of one item embedded in an order, by that item's own _id. */
export async function updateOrderItem(
  ctx: AuthContext,
  orderId: string,
  itemId: string,
  fields: Record<string, unknown>,
): Promise<boolean> {
  if (!mongoose.isValidObjectId(orderId) || !mongoose.isValidObjectId(itemId)) return false
  const $set = Object.fromEntries(Object.entries(fields).map(([k, v]) => [`items.$.${k}`, v]))
  const res = await Order.updateOne(
    scoped(ctx, { _id: new mongoose.Types.ObjectId(orderId), 'items._id': new mongoose.Types.ObjectId(itemId) }),
    { $set },
  )
  return res.matchedCount > 0
}

/** Scoped append of packing items to an order. */
export async function addOrderItems(
  ctx: AuthContext,
  orderId: string,
  items: Record<string, unknown>[],
): Promise<boolean> {
  if (!mongoose.isValidObjectId(orderId) || items.length === 0) return false
  const res = await Order.updateOne(
    scoped(ctx, { _id: new mongoose.Types.ObjectId(orderId) }),
    { $push: { items: { $each: items } } },
  )
  return res.matchedCount > 0
}

/**
 * How many orders belong to an outlet, and how many record a given user.
 *
 * Used only to decide whether a setup row may be deleted. The rule this backs
 * is plan §2's: an order pointing at a record that no longer exists vanishes
 * from every dashboard with no error anywhere, so a row anything still points
 * at is deactivated rather than deleted. Admin only, since only an admin can
 * see across every outlet to answer the question honestly.
 */
export async function countOrdersForOutlet(ctx: AuthContext, outletId: string): Promise<number> {
  if (ctx.role !== 'ADMIN') throw new ForbiddenError('Only an admin may check this.')
  if (!mongoose.isValidObjectId(outletId)) return 0
  return Order.countDocuments(scoped(ctx, { restaurantId: new mongoose.Types.ObjectId(outletId) }))
}

export async function countOrdersRecordingUser(ctx: AuthContext, userId: string): Promise<number> {
  if (ctx.role !== 'ADMIN') throw new ForbiddenError('Only an admin may check this.')
  if (!mongoose.isValidObjectId(userId)) return 0
  const id = new mongoose.Types.ObjectId(userId)
  return Order.countDocuments(
    scoped(ctx, {
      $or: [
        { 'events.userId': id },
        { 'callLog.userId': id },
        { 'delivery.agentIds': id },
        { createdById: id },
      ],
    }),
  )
}

/** Longest one call note may be. The same number as the admin remark. */
export const CALL_NOTE_MAX = 500

/**
 * How many notes one order keeps.
 *
 * Fifty calls about a single thali is already a pathological order; this is
 * here so a runaway client cannot grow one document without bound, not because
 * anyone is expected to reach it.
 */
export const CALL_LOG_LIMIT = 50

export type CallNote = {
  text: string
  userId: mongoose.Types.ObjectId
  createdAt: Date
}

/**
 * Appends one note to an order's call log.
 *
 * The role check lives here rather than at the call site, for the same reason
 * setPaymentRemark's does: this is the door, and a door that trusts every
 * caller to have checked is one new caller away from not being a door. A store
 * manager and a rider read this log; neither writes to it.
 *
 * Append, not read-modify-write. $push is atomic, so two telecallers finishing
 * calls on the same order at the same moment both land, where `remark`'s $set
 * would silently lose one of them. $slice trims in the same operation, so the
 * bound is enforced by the database rather than by whoever calls this next; it
 * drops the oldest note rather than refusing the write, because telling a
 * telecaller mid-call that an order has too many notes is the worse failure.
 *
 * No status gate. A passenger ringing back about an order that was already
 * cancelled or delivered is exactly the call worth writing down.
 */
export async function appendCallNote(
  ctx: AuthContext,
  orderId: string,
  text: string,
): Promise<CallNote> {
  if (ctx.role !== 'TELECALLER' && ctx.role !== 'ADMIN') {
    throw new ForbiddenError('Only a telecaller or an admin may add a call note.')
  }

  // updateOne runs no subdocument validators, so CallNoteSchema's maxlength is
  // documentation on this path and these two checks are what actually hold.
  const body = text.trim()
  if (body.length === 0) throw new Error('A call note cannot be empty.')
  if (body.length > CALL_NOTE_MAX) {
    throw new Error(`Keep a call note under ${CALL_NOTE_MAX} characters.`)
  }

  if (!mongoose.isValidObjectId(orderId)) throw new NotFoundError('Order not found')

  const note: CallNote = { text: body, userId: ctx.userId, createdAt: new Date() }

  const res = await Order.updateOne(
    scoped(ctx, { _id: new mongoose.Types.ObjectId(orderId) }),
    { $push: { callLog: { $each: [note], $slice: -CALL_LOG_LIMIT } } },
  )
  // Scoped, so another outlet's order is a miss rather than a refusal — a 403
  // here would itself confirm the order exists.
  if (res.matchedCount === 0) throw new NotFoundError('Order not found')

  return note
}

/**
 * May this caller change this note?
 *
 * Its author, or an admin. A store manager and a rider read the log and write
 * nothing to it, so neither reaches here at all; between a telecaller and the
 * admin who oversees the desk, the question is only ever whose note it is.
 */
function ownsNote(ctx: AuthContext, note: { userId?: mongoose.Types.ObjectId | null }): boolean {
  if (ctx.role === 'ADMIN') return true
  return Boolean(note.userId && ctx.userId.equals(note.userId))
}

/** Locates one note on a scoped order, or throws the reason it cannot. */
async function findNote(ctx: AuthContext, orderId: string, noteId: string) {
  if (ctx.role !== 'TELECALLER' && ctx.role !== 'ADMIN') {
    throw new ForbiddenError('Only a telecaller or an admin may change a call note.')
  }
  if (!mongoose.isValidObjectId(orderId) || !mongoose.isValidObjectId(noteId)) {
    throw new NotFoundError('Note not found')
  }

  const order = await findById(ctx, orderId)
  if (!order) throw new NotFoundError('Order not found')

  const note = (order.callLog ?? []).find((n) => String(n._id) === noteId)
  if (!note) throw new NotFoundError('Note not found')

  if (!ownsNote(ctx, note)) {
    // Not a NotFoundError: the caller can already see this note in the log, so
    // there is nothing to conceal and every reason to say why the pencil did
    // not work.
    throw new ForbiddenError('You can only change a note you wrote yourself.')
  }
  return note
}

/**
 * Corrects one note in place, stamping `editedAt`.
 *
 * The positional `$` operator matches the same note the filter found, so this
 * cannot write over a neighbour if the array shifted between the read above
 * and this write.
 */
export async function editCallNote(
  ctx: AuthContext,
  orderId: string,
  noteId: string,
  text: string,
): Promise<void> {
  await findNote(ctx, orderId, noteId)

  const body = text.trim()
  if (body.length === 0) throw new Error('A call note cannot be empty.')
  if (body.length > CALL_NOTE_MAX) {
    throw new Error(`Keep a call note under ${CALL_NOTE_MAX} characters.`)
  }

  const res = await Order.updateOne(
    scoped(ctx, {
      _id: new mongoose.Types.ObjectId(orderId),
      'callLog._id': new mongoose.Types.ObjectId(noteId),
    }),
    { $set: { 'callLog.$.text': body, 'callLog.$.editedAt': new Date() } },
  )
  if (res.matchedCount === 0) throw new NotFoundError('Note not found')
}

/**
 * Removes one note outright.
 *
 * A real delete, with no tombstone: this log is a working record of what was
 * said on the phone, and a mistyped note nobody can clear is worse than one
 * that can be. The event log beside it is the part that cannot be rewritten.
 */
export async function deleteCallNote(
  ctx: AuthContext,
  orderId: string,
  noteId: string,
): Promise<void> {
  await findNote(ctx, orderId, noteId)

  const res = await Order.updateOne(
    scoped(ctx, { _id: new mongoose.Types.ObjectId(orderId) }),
    { $pull: { callLog: { _id: new mongoose.Types.ObjectId(noteId) } } },
  )
  if (res.matchedCount === 0) throw new NotFoundError('Order not found')
}

/**
 * The whole log for one order, resolved and flattened for a screen.
 *
 * Returned by every write so a caller holding its own copy of the order (the
 * admin slide-over) can paint the result without a second round trip, and
 * without racing a refetch against the revalidation the same action triggers.
 */
type LeanCallNote = OrderDoc['callLog'][number]

/**
 * Flattens a log for a screen. Pure, because every order page has already
 * fetched the order and resolved its actors for the event log beside it, and
 * a second round trip to say the same thing again would be waste.
 */
export function viewCallNotes(
  ctx: AuthContext,
  callLog: LeanCallNote[] | undefined | null,
  authorLabel: Map<string, string>,
): CallNoteView[] {
  return (callLog ?? []).map((n) => ({
    id: String(n._id),
    text: n.text,
    author: n.userId ? (authorLabel.get(String(n.userId)) ?? 'Unknown user') : null,
    at: n.createdAt.toISOString(),
    editedAt: n.editedAt ? n.editedAt.toISOString() : null,
    canManage: ownsNote(ctx, n),
  }))
}

export async function listCallNotes(
  ctx: AuthContext,
  orderId: string,
): Promise<CallNoteView[]> {
  const order = await findById(ctx, orderId)
  if (!order) throw new NotFoundError('Order not found')

  const notes = order.callLog ?? []
  if (notes.length === 0) return []

  const authorIds = notes
    .map((n) => n.userId)
    .filter((v): v is mongoose.Types.ObjectId => Boolean(v))
  const authors = authorIds.length
    ? await User.find({ _id: { $in: authorIds } }).select('name role').lean()
    : []
  const label = new Map(
    authors.map((a) => [String(a._id), `${a.name} · ${ROLE_LABEL[a.role] ?? a.role}`]),
  )

  return viewCallNotes(ctx, notes, label)
}

/**
 * Mints the next human-readable manual order id: MAN-20260827-001.
 * Atomic via $inc, so two admins submitting at once cannot collide.
 */
export async function nextManualOrderId(serviceDate: string): Promise<string> {
  const key = `manualOrder:${serviceDate}`
  const doc = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' },
  )
  const seq = String(doc!.seq).padStart(3, '0')
  return `MAN-${serviceDate.replace(/-/g, '')}-${seq}`
}

/** Order creation. Status is set here once, and only here, at birth. */
export async function insertOrder(doc: Record<string, unknown>) {
  return Order.create(doc)
}

/**
 * Raw unscoped handle, for the transition engine and ingestion only.
 * Named to be conspicuous in a diff — if you are reaching for this from a
 * page or a route handler, you want `scoped()` instead.
 */
export const __unsafeOrderModel = Order

/**
 * Admin analytics (plan §5 phase 5). Aggregations still go through scoped(),
 * so this is safe to widen to a store manager later without becoming a leak.
 */
export type OutletStats = {
  restaurantId: string | null
  orders: number
  delivered: number
  failed: number
  cancelled: number
  /**
   * FAILED/CANCELLED/LOST, plus orders still in a non-terminal status whose
   * train arrived over an hour ago — stuck orders nobody closed out are a
   * miss too, not a status a dashboard should have to know to go looking for.
   */
  missed: number
  missedRevenuePaise: number
  revenuePaise: number
  avgReceivedToDeliveredMinutes: number | null
}

export async function outletAnalytics(
  ctx: AuthContext,
  range: { from: string; to: string },
): Promise<OutletStats[]> {
  return Order.aggregate<OutletStats>([
    { $match: scoped(ctx, { serviceDate: { $gte: range.from, $lte: range.to } }) },
    {
      $addFields: {
        // Received-to-delivered is measured from the event log rather than
        // createdAt/updatedAt: updatedAt moves on any later edit, which would
        // quietly inflate the number.
        receivedAt: {
          $min: {
            $map: {
              input: {
                $filter: {
                  input: '$events', as: 'e',
                  cond: { $eq: ['$$e.toStatus', 'RECEIVED'] },
                },
              },
              as: 'e', in: '$$e.createdAt',
            },
          },
        },
        deliveredAt: '$delivery.deliveredAt',
        // Explicitly failed/cancelled/lost, OR still open an hour after the
        // train it rode in on — stuck in RECEIVED/ACCEPTED/.../DISPATCHED
        // because someone forgot to close it out is a miss too, just one
        // nobody marked.
        isMissed: {
          $or: [
            { $in: ['$status', ['FAILED', 'CANCELLED', 'LOST']] },
            {
              $and: [
                { $not: { $in: ['$status', ['DELIVERED', 'FAILED', 'CANCELLED', 'LOST']] } },
                { $ne: ['$scheduledArrival', null] },
                { $lt: ['$scheduledArrival', { $subtract: ['$$NOW', 60 * 60 * 1000] }] },
              ],
            },
          ],
        },
      },
    },
    {
      $group: {
        _id: '$restaurantId',
        orders: { $sum: 1 },
        delivered: { $sum: { $cond: [{ $eq: ['$status', 'DELIVERED'] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ['$status', 'FAILED'] }, 1, 0] } },
        cancelled: {
          $sum: { $cond: [{ $in: ['$status', ['CANCELLED', 'LOST']] }, 1, 0] },
        },
        missed: { $sum: { $cond: ['$isMissed', 1, 0] } },
        missedRevenuePaise: {
          $sum: { $cond: ['$isMissed', { $ifNull: ['$amountPaise', 0] }, 0] },
        },
        revenuePaise: {
          $sum: { $cond: [{ $eq: ['$status', 'DELIVERED'] }, { $ifNull: ['$amountPaise', 0] }, 0] },
        },
        durations: {
          $push: {
            $cond: [
              { $and: ['$receivedAt', '$deliveredAt'] },
              { $divide: [{ $subtract: ['$deliveredAt', '$receivedAt'] }, 60000] },
              '$$REMOVE',
            ],
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        restaurantId: { $toString: '$_id' },
        orders: 1, delivered: 1, failed: 1, cancelled: 1,
        missed: 1, missedRevenuePaise: 1, revenuePaise: 1,
        avgReceivedToDeliveredMinutes: {
          $cond: [
            { $gt: [{ $size: '$durations' }, 0] },
            { $round: [{ $avg: '$durations' }, 0] },
            null,
          ],
        },
      },
    },
    { $sort: { orders: -1 } },
  ])
}

/** Daily order counts for a simple trend line. */
export async function dailyCounts(
  ctx: AuthContext,
  range: { from: string; to: string },
): Promise<{ serviceDate: string; orders: number; delivered: number }[]> {
  return Order.aggregate([
    { $match: scoped(ctx, { serviceDate: { $gte: range.from, $lte: range.to } }) },
    {
      $group: {
        _id: '$serviceDate',
        orders: { $sum: 1 },
        delivered: { $sum: { $cond: [{ $eq: ['$status', 'DELIVERED'] }, 1, 0] } },
      },
    },
    { $project: { _id: 0, serviceDate: '$_id', orders: 1, delivered: 1 } },
    { $sort: { serviceDate: 1 } },
  ])
}

// ---------------------------------------------------------------------------
// System-context access.
//
// The background worker has no logged-in user, so there is no ctx to scope by
// and scoped() has nothing to apply. That is legitimate — a polling job is
// meant to see every outlet — but it must not become a general escape hatch,
// so those queries live here with the rest of the Order access rather than
// being lint-exempted wherever they are convenient. Every function below is
// named `system*` so it is obvious in a diff that no tenant filter applies.
// ---------------------------------------------------------------------------

import type { Types } from 'mongoose'
import type { OrderStatus } from '../orderStatus'

export type ActiveTrainGroup = {
  _id: { trainNo: string; stationCode: string }
  scheduledArrival: Date | null
  orderIds: Types.ObjectId[]
  restaurantIds: Types.ObjectId[]
  statuses: string[]
}

/**
 * Trains with at least one active order on a date, across all outlets.
 * Plan §8: only these are worth polling.
 */
export async function systemFindActiveTrainGroups(
  serviceDate: string,
  statuses: OrderStatus[],
): Promise<ActiveTrainGroup[]> {
  return Order.aggregate<ActiveTrainGroup>([
    {
      $match: {
        serviceDate,
        status: { $in: statuses },
        trainNo: { $ne: null, $exists: true },
      },
    },
    {
      $group: {
        _id: { trainNo: '$trainNo', stationCode: '$stationCode' },
        scheduledArrival: { $min: '$scheduledArrival' },
        orderIds: { $push: '$_id' },
        restaurantIds: { $addToSet: '$restaurantId' },
        statuses: { $push: '$status' },
      },
    },
  ])
}

/**
 * Records the leave-now alert on each still-PREPARED order, exactly once.
 * Returns how many orders were newly notified.
 */
export async function systemRecordLeaveNow(
  orderIds: Types.ObjectId[],
  meta: Record<string, unknown>,
  now: Date,
): Promise<number> {
  const res = await Order.updateMany(
    {
      _id: { $in: orderIds },
      status: 'PREPARED',
      // Idempotent: a repeating tick must not append the same alert every minute.
      'events.meta.action': { $ne: 'LEAVE_NOW' },
    },
    {
      $push: {
        events: {
          fromStatus: 'PREPARED',
          toStatus: 'PREPARED',
          userId: null,
          meta: { action: 'LEAVE_NOW', ...meta },
          createdAt: now,
        },
      },
    },
  )
  return res.modifiedCount
}
