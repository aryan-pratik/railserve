import mongoose, { type QueryFilter } from 'mongoose'
import { Order, type OrderDoc } from '../models'
import type { AuthContext } from '../authContext'
import {
  EXCLUDED_STATUS, NO_OUTLET, NO_PAYMENT, OUTCOME_STATUSES, isOutcome,
  type AnalyticsFilters, type CountRow, type Dimension,
} from '../analytics'
import { scoped } from './orderRepo'

/**
 * The queries behind the admin Analytics screen and its export.
 *
 * Every one goes through scoped(), like the rest of the order reads, so the
 * screen can be opened to a store manager later without becoming a leak.
 */

const KNOWN_STATUSES = Object.values(OUTCOME_STATUSES).flat()

/**
 * The Mongo clause for the screen's filters. `status: false` leaves the
 * status filter out: the overview tiles count every status so that picking
 * one does not blank the others.
 *
 * Aggregation pipelines are not cast by Mongoose, so the outlet id is turned
 * into an ObjectId here rather than passed through as the URL's string.
 */
export function analyticsMatch(f: AnalyticsFilters, opts: { status?: boolean } = {}): QueryFilter<OrderDoc> {
  const and: Record<string, unknown>[] = [
    { serviceDate: { $gte: f.from, $lte: f.to } },
    { status: { $ne: EXCLUDED_STATUS } },
  ]
  if (f.outlet === NO_OUTLET) and.push({ restaurantId: null })
  else if (f.outlet) and.push({ restaurantId: new mongoose.Types.ObjectId(f.outlet) })
  if (f.stations.length) and.push({ stationCode: { $in: f.stations } })
  if (f.source) and.push({ source: f.source })
  if (f.payment === NO_PAYMENT) and.push({ paymentMode: null })
  else if (f.payment) and.push({ paymentMode: f.payment })
  if (f.type) and.push({ orderType: f.type })
  if (f.status && opts.status !== false) {
    if (!isOutcome(f.status)) and.push({ status: f.status })
    else if (f.status === 'other') and.push({ status: { $nin: KNOWN_STATUSES } })
    else and.push({ status: { $in: OUTCOME_STATUSES[f.status] } })
  }
  return { $and: and } as QueryFilter<OrderDoc>
}

const DIMENSION_FIELD: Record<Dimension, string> = {
  outlet: '$restaurantId',
  station: '$stationCode',
  source: '$source',
  payment: '$paymentMode',
  status: '$status',
  day: '$serviceDate',
}

/**
 * Orders and bill value per status, split by one dimension, or as a single
 * group when none is given. Statuses are folded into outcomes by the caller,
 * so the same rows serve the tiles, the chart and the table.
 */
export async function countOrdersBy(
  ctx: AuthContext,
  match: QueryFilter<OrderDoc>,
  by: Dimension | null,
): Promise<CountRow[]> {
  const rows = await Order.aggregate<{ _id: { k: unknown; s: string }; orders: number; amountPaise: number }>([
    { $match: scoped(ctx, match) },
    {
      $group: {
        _id: { k: by ? DIMENSION_FIELD[by] : null, s: '$status' },
        orders: { $sum: 1 },
        amountPaise: { $sum: { $ifNull: ['$amountPaise', 0] } },
      },
    },
  ])
  return rows.map((r) => ({
    key: r._id.k == null ? null : String(r._id.k),
    status: r._id.s,
    orders: r.orders,
    amountPaise: r.amountPaise,
  }))
}

/**
 * Orders still open an hour after their train was due. Nobody marked them
 * undelivered, but nobody delivered them either, so the In progress figure
 * says how many of its orders are really just unclosed.
 */
export async function countOverdueOpen(ctx: AuthContext, match: QueryFilter<OrderDoc>): Promise<number> {
  return Order.countDocuments(
    scoped(ctx, {
      $and: [
        match,
        { status: { $in: OUTCOME_STATUSES.progress } },
        { scheduledArrival: { $ne: null, $lt: new Date(Date.now() - 60 * 60 * 1000) } },
      ],
    } as QueryFilter<OrderDoc>),
  )
}

export type CodSummary = {
  /** Every cash-on-delivery order in view, whatever became of it. */
  orders: number
  billedPaise: number
  /** The delivered ones: cash that actually changed hands. */
  deliveredOrders: number
  collectedPaise: number
  /** Of that, what a store manager has taken off the rider. */
  settledPaise: number
  /** Delivered, but the cash is still with the rider. */
  pendingOrders: number
  pendingPaise: number
}

/**
 * Where the cash-on-delivery money in view stands. Cash per order is what the
 * rider recorded, or the bill when nobody recorded it: the same reading the
 * rider cash screens use, so the two never disagree about a rupee.
 */
export async function codSummary(ctx: AuthContext, match: QueryFilter<OrderDoc>): Promise<CodSummary> {
  const cash = { $ifNull: ['$delivery.amountCollectedPaise', { $ifNull: ['$amountPaise', 0] }] }
  const delivered = { $eq: ['$status', 'DELIVERED'] }
  const settled = { $and: [delivered, { $ne: [{ $ifNull: ['$delivery.codSettledAt', null] }, null] }] }
  const pending = { $and: [delivered, { $eq: [{ $ifNull: ['$delivery.codSettledAt', null] }, null] }] }
  const [row] = await Order.aggregate<CodSummary>([
    { $match: scoped(ctx, { $and: [match, { paymentMode: 'COD' }] } as QueryFilter<OrderDoc>) },
    {
      $group: {
        _id: null,
        orders: { $sum: 1 },
        billedPaise: { $sum: { $ifNull: ['$amountPaise', 0] } },
        deliveredOrders: { $sum: { $cond: [delivered, 1, 0] } },
        collectedPaise: { $sum: { $cond: [delivered, cash, 0] } },
        settledPaise: { $sum: { $cond: [settled, cash, 0] } },
        pendingOrders: { $sum: { $cond: [pending, 1, 0] } },
        pendingPaise: { $sum: { $cond: [pending, cash, 0] } },
      },
    },
    { $project: { _id: 0 } },
  ])
  return row ?? {
    orders: 0, billedPaise: 0, deliveredOrders: 0, collectedPaise: 0, settledPaise: 0, pendingOrders: 0, pendingPaise: 0,
  }
}
