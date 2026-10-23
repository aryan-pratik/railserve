import mongoose, { type PipelineStage } from 'mongoose'
import { Order, User } from '../models'
import { connectDb } from '../db'
import { ForbiddenError, type AuthContext } from '../authContext'
import { scoped } from './orderRepo'
import {
  ACTIVITY_PANELS,
  KIND_ACTIONS,
  PANEL_ROLE,
  RIDER_WEB_VIAS,
  kindOf,
  panelOf,
  type ActivityKind,
  type ActivityPanel,
} from '../activity'

/**
 * The activity log: every order event and call note, across every order,
 * newest first.
 *
 * A read, not a new record. Each order already keeps its own event log —
 * transitionOrder, the admin editor, the cancel-request desk, the cash
 * handover and the rider app all push to it, each naming who acted — and its
 * own call log. This unwinds both across the collection and pages through the
 * result, so nothing that writes an event had to change, and history from
 * before this screen existed is already in it.
 *
 * What it cannot show is anything that was never written to an order: staff
 * and outlet edits in Setup, logins, a payment remark that was overwritten,
 * and the events of an order that was deleted (deleteOrder takes the log with
 * it).
 *
 * Reaches the Order model through `scoped()`, like every other repository
 * here. ADMIN-only today; the scope is there so opening it wider would leak
 * nothing.
 */

/** [from, to) in UTC. */
export type ActivityRange = { from: Date; to: Date }

export type ActivityQuery = {
  /** Required unless `riderId` narrows the read to one rider's orders. */
  range: ActivityRange | null
  panel?: ActivityPanel | null
  kind?: ActivityKind | null
  /** Who acted. */
  actorId?: string | null
  /** A fragment of the order id, matched case-insensitively. */
  orderId?: string | null
  stationCode?: string | null
  /**
   * One rider's record: what they did, and what was done to their deliveries
   * by anyone else — being assigned or taken off an order, a manager handing
   * food over for them, a telecaller closing one of theirs, their cash being
   * collected. Call notes are left out; they are the call desk's, not theirs.
   */
  riderId?: string | null
  skip: number
  limit: number
}

export type ActivityEntry = {
  /** Stable across pages: order id plus the entry's own id. */
  id: string
  type: 'event' | 'note'
  at: Date
  orderId: string
  externalOrderId: string
  stationCode: string
  trainNo: string | null
  actor: { id: string; name: string; role: string } | null
  panel: ActivityPanel
  kind: ActivityKind
  fromStatus: string | null
  toStatus: string
  meta: Record<string, unknown>
  /** A call note's text. Null on an event. */
  text: string | null
  /** When a call note was corrected after it was written. */
  editedAt: Date | null
}

export type ActivityFeed = {
  rows: ActivityEntry[]
  total: number
  /** Entries per panel across every other filter, for the panel tabs. */
  panelCounts: Record<ActivityPanel, number>
  /** Names for the rider ids an assignment or cash event carries. */
  names: Map<string, string>
}

/** Statuses an order passes through once a rider has it, or ends in. */
const DELIVERY_PHASE = [
  'DISPATCHED', 'DELIVERED', 'FAILED', 'CANCELLED', 'MISDELIVERY', 'MISSED_DELIVERY', 'REFUNDED',
]

/**
 * Every action that files under some kind other than EDIT. EDIT is its own
 * actions plus whatever nobody has named yet, so it is matched as the rest.
 */
const NOT_EDIT_ACTIONS: string[] = [
  'CREATED',
  ...Object.entries(KIND_ACTIONS).flatMap(([kind, actions]) => (kind === 'EDIT' ? [] : actions)),
]

/**
 * The query that picks out one kind, on an unwound event `e` carrying the
 * `moved` flag. Mirrors kindOf exactly — the test holds the two together.
 */
function kindMatch(kind: ActivityKind): Record<string, unknown> | null {
  const sideEvent = { moved: false, 'e.fromStatus': { $ne: null }, 'e.meta.via': { $ne: 'cancel-request' } }
  switch (kind) {
    case 'CREATED':
      return { $or: [{ 'e.fromStatus': null }, { 'e.meta.action': 'CREATED' }] }
    case 'STATUS':
      return {
        moved: true,
        'e.fromStatus': { $ne: null },
        'e.meta.action': { $ne: 'CREATED' },
        'e.meta.via': { $ne: 'cancel-request' },
      }
    case 'CANCEL_REQUEST':
      return {
        'e.fromStatus': { $ne: null },
        'e.meta.action': { $ne: 'CREATED' },
        $or: [
          { moved: false, 'e.meta.action': { $in: [...KIND_ACTIONS.CANCEL_REQUEST] } },
          { 'e.meta.via': 'cancel-request' },
        ],
      }
    case 'ASSIGN':
    case 'CASH':
    case 'ALERT':
      return { ...sideEvent, 'e.meta.action': { $in: [...KIND_ACTIONS[kind]] } }
    case 'EDIT':
      return { ...sideEvent, 'e.meta.action': { $nin: NOT_EDIT_ACTIONS } }
    case 'CALL_NOTE':
      return null
  }
}

/** Order ids, roles and panels, as plain ids for a $match. */
type Roster = Map<string, { name: string; role: string }>

async function roster(): Promise<Roster> {
  const users = await User.find().select('name role').lean()
  return new Map(users.map((u) => [String(u._id), { name: u.name, role: u.role }]))
}

/** The ids of everyone whose role makes up a panel. */
function idsWithRole(people: Roster, role: string): mongoose.Types.ObjectId[] {
  return [...people].filter(([, p]) => p.role === role).map(([id]) => new mongoose.Types.ObjectId(id))
}

/** One panel, on the common entry shape below (`userId`, `via`). */
function panelMatch(panel: ActivityPanel, people: Roster): Record<string, unknown> {
  if (panel === 'SYSTEM') {
    // Not just `userId: null`: an id whose user has since been deleted reads
    // as System on screen too, and the filter has to agree with the screen.
    const known = [...people.keys()].map((id) => new mongoose.Types.ObjectId(id))
    return { userId: { $nin: known } }
  }
  const match: Record<string, unknown> = { userId: { $in: idsWithRole(people, PANEL_ROLE[panel]) } }
  if (panel === 'RIDER_APP') match.via = { $nin: [...RIDER_WEB_VIAS] }
  if (panel === 'RIDER_WEB') match.via = { $in: [...RIDER_WEB_VIAS] }
  return match
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function activityFeed(ctx: AuthContext, q: ActivityQuery): Promise<ActivityFeed> {
  if (ctx.role !== 'ADMIN') throw new ForbiddenError('Only an admin may read the activity log.')

  const rider =
    q.riderId && mongoose.isValidObjectId(q.riderId) ? new mongoose.Types.ObjectId(q.riderId) : null
  // Unbounded, this would unwind every event ever written. One rider's orders
  // are a bounded set; the whole collection is not.
  if (!q.range && !rider) throw new Error('activityFeed needs a date range or a rider')

  const actor =
    q.actorId && mongoose.isValidObjectId(q.actorId) ? new mongoose.Types.ObjectId(q.actorId) : null

  await connectDb()
  const people = await roster()

  // ── Which orders to open. Indexed: events.createdAt, events.userId and
  // delivery.agentIds all are (scripts/indexes.ts).
  const orderMatch: Record<string, unknown>[] = []
  const timeMatch = q.range ? { createdAt: { $gte: q.range.from, $lt: q.range.to } } : {}
  if (q.range || actor) {
    orderMatch.push({ events: { $elemMatch: { ...timeMatch, ...(actor ? { userId: actor } : {}) } } })
  }
  if (rider) {
    orderMatch.push({ $or: [{ 'delivery.agentIds': rider }, { 'events.userId': rider }] })
  }
  const term = (q.orderId ?? '').replace(/^\s*#\s*/, '').trim()
  if (term) orderMatch.push({ externalOrderId: { $regex: escapeRegex(term), $options: 'i' } })
  if (q.stationCode) orderMatch.push({ stationCode: q.stationCode.toUpperCase() })

  const orderFilter = orderMatch.length ? { $and: orderMatch } : {}

  // ── Which events, once each order is unwound to one row per event.
  const eventMatch: Record<string, unknown>[] = []
  if (q.range) eventMatch.push({ 'e.createdAt': { $gte: q.range.from, $lt: q.range.to } })
  if (actor) eventMatch.push({ 'e.userId': actor })
  if (q.kind) {
    const k = kindMatch(q.kind)
    // A call-note filter wants no events at all.
    eventMatch.push(k ?? { _id: { $exists: false } })
  }
  if (rider) {
    const either = { $in: [rider, String(rider)] }
    eventMatch.push({
      $or: [
        { 'e.userId': rider },
        { 'e.meta.agentIds': either },
        { 'e.meta.fromAgentIds': either },
        { 'e.meta.riderId': either },
        // What anyone else did to an order this rider is carrying, once it
        // was out of the kitchen: a handover, a telecaller closing it.
        {
          carried: true,
          moved: true,
          $or: [{ 'e.toStatus': { $in: DELIVERY_PHASE } }, { 'e.fromStatus': { $in: DELIVERY_PHASE } }],
        },
      ],
    })
  }

  const orderFields = { externalOrderId: 1, stationCode: 1, trainNo: 1 }

  const events: PipelineStage[] = [
    { $match: scoped(ctx, orderFilter) },
    {
      $project: {
        ...orderFields,
        e: '$events',
        ...(rider ? { carried: { $in: [rider, { $ifNull: ['$delivery.agentIds', []] }] } } : {}),
      },
    },
    { $unwind: '$e' },
    { $addFields: { moved: { $ne: ['$e.fromStatus', '$e.toStatus'] } } },
    ...(eventMatch.length ? [{ $match: { $and: eventMatch } }] : []),
    {
      $project: {
        _id: 0,
        ...orderFields,
        orderId: '$_id',
        type: { $literal: 'event' },
        entryId: '$e._id',
        at: '$e.createdAt',
        userId: '$e.userId',
        via: '$e.meta.via',
        fromStatus: '$e.fromStatus',
        toStatus: '$e.toStatus',
        meta: '$e.meta',
        text: { $literal: null },
        editedAt: { $literal: null },
      },
    },
  ]

  // Call notes ride along unless a filter rules them out: a rider's record
  // and every event-only kind do.
  const withNotes = !rider && (!q.kind || q.kind === 'CALL_NOTE')
  const noteTime = q.range ? { createdAt: { $gte: q.range.from, $lt: q.range.to } } : {}
  const notes: PipelineStage[] = withNotes
    ? [
        {
          $unionWith: {
            coll: Order.collection.collectionName,
            pipeline: [
              {
                $match: scoped(ctx, {
                  $and: [
                    { callLog: { $elemMatch: { ...noteTime, ...(actor ? { userId: actor } : {}) } } },
                    ...orderMatch.filter((m) => !('events' in m)),
                  ],
                }),
              },
              { $project: { ...orderFields, status: 1, n: '$callLog' } },
              { $unwind: '$n' },
              {
                $match: {
                  ...(q.range ? { 'n.createdAt': { $gte: q.range.from, $lt: q.range.to } } : {}),
                  ...(actor ? { 'n.userId': actor } : {}),
                },
              },
              {
                $project: {
                  _id: 0,
                  ...orderFields,
                  orderId: '$_id',
                  type: { $literal: 'note' },
                  entryId: '$n._id',
                  at: '$n.createdAt',
                  userId: '$n.userId',
                  via: { $literal: null },
                  fromStatus: '$status',
                  toStatus: '$status',
                  meta: { $literal: {} },
                  text: '$n.text',
                  editedAt: '$n.editedAt',
                },
              },
            ],
          },
        },
      ]
    : []

  const onPanel = q.panel ? [{ $match: panelMatch(q.panel, people) }] : []

  type Raw = {
    orderId: mongoose.Types.ObjectId
    externalOrderId: string
    stationCode: string
    trainNo?: string | null
    type: 'event' | 'note'
    entryId?: mongoose.Types.ObjectId | null
    at: Date
    userId?: mongoose.Types.ObjectId | null
    via?: unknown
    fromStatus?: string | null
    toStatus: string
    meta?: Record<string, unknown> | null
    text?: string | null
    editedAt?: Date | null
  }

  const [out] = await Order.aggregate<{
    rows: Raw[]
    total: { n: number }[]
    byActor: { _id: { u: mongoose.Types.ObjectId | null; web: boolean }; n: number }[]
  }>([
    ...events,
    ...notes,
    {
      $facet: {
        // Before the panel filter, so every tab shows what it would hold.
        byActor: [
          {
            $group: {
              _id: { u: '$userId', web: { $in: [{ $ifNull: ['$via', null] }, [...RIDER_WEB_VIAS]] } },
              n: { $sum: 1 },
            },
          },
        ],
        total: [...onPanel, { $count: 'n' }],
        rows: [
          ...onPanel,
          // Ties broken all the way down, or entries written in one save —
          // an edit of three fields is three events at one instant — could
          // swap places between pages and be shown twice or not at all.
          { $sort: { at: -1, orderId: -1, entryId: -1 } },
          { $skip: q.skip },
          { $limit: q.limit },
        ],
      },
    },
  ]).allowDiskUse(true)

  const panelCounts = Object.fromEntries(ACTIVITY_PANELS.map((p) => [p, 0])) as Record<ActivityPanel, number>
  for (const g of out?.byActor ?? []) {
    const person = g._id.u ? people.get(String(g._id.u)) : undefined
    panelCounts[panelOf(person?.role, g._id.web ? RIDER_WEB_VIAS[0] : null)] += g.n
  }

  const rows = (out?.rows ?? []).map((r): ActivityEntry => {
    const person = r.userId ? people.get(String(r.userId)) : undefined
    const meta = (r.meta ?? {}) as Record<string, unknown>
    const fromStatus = r.fromStatus ?? null
    return {
      id: `${r.orderId}:${r.entryId ?? r.at.getTime()}`,
      type: r.type,
      at: r.at,
      orderId: String(r.orderId),
      externalOrderId: r.externalOrderId,
      stationCode: r.stationCode,
      trainNo: r.trainNo ?? null,
      actor: person && r.userId ? { id: String(r.userId), ...person } : null,
      panel: panelOf(person?.role, r.via),
      kind: r.type === 'note' ? 'CALL_NOTE' : kindOf({ fromStatus, toStatus: r.toStatus, meta }),
      fromStatus,
      toStatus: r.toStatus,
      meta,
      text: r.text ?? null,
      editedAt: r.editedAt ?? null,
    }
  })

  return {
    rows,
    total: out?.total[0]?.n ?? 0,
    panelCounts,
    names: new Map([...people].map(([id, p]) => [id, p.name])),
  }
}

/** Orders per status for one rider, with the money on them. */
export type RiderStatusCount = {
  status: string
  orders: number
  amountPaise: number
  codOrders: number
  codPaise: number
}

/**
 * What one rider has had, counted by where each order ended up.
 *
 * Every order they were on, by `delivery.agentIds` — the same field the board
 * counts by — so assigned-but-not-collected and cancelled orders are here too.
 * The page buckets the statuses; this only counts them.
 */
export async function riderStatusCounts(
  ctx: AuthContext,
  riderId: mongoose.Types.ObjectId,
  serviceDate: { from?: string; to?: string },
): Promise<RiderStatusCount[]> {
  if (ctx.role !== 'ADMIN') throw new ForbiddenError("Only an admin may read a rider's record.")
  await connectDb()
  const date: Record<string, string> = {}
  if (serviceDate.from) date.$gte = serviceDate.from
  if (serviceDate.to) date.$lte = serviceDate.to
  const isCod = { $eq: ['$paymentMode', 'COD'] }
  const rows = await Order.aggregate<RiderStatusCount & { _id: string }>([
    {
      $match: scoped(ctx, {
        'delivery.agentIds': riderId,
        ...(Object.keys(date).length ? { serviceDate: date } : {}),
      }),
    },
    {
      $group: {
        _id: '$status',
        orders: { $sum: 1 },
        amountPaise: { $sum: { $ifNull: ['$amountPaise', 0] } },
        codOrders: { $sum: { $cond: [isCod, 1, 0] } },
        codPaise: { $sum: { $cond: [isCod, { $ifNull: ['$amountPaise', 0] }, 0] } },
      },
    },
  ])
  return rows.map(({ _id, ...r }) => ({ ...r, status: _id }))
}
