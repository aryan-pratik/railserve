import mongoose, { type QueryFilter } from 'mongoose'
import { Order, type OrderDoc } from '../models'
import { connectDb } from '../db'
import type { AuthContext } from '../authContext'
import { onRiderRecord, outletScoped } from './orderRepo'
import { OVERALL_CANCELLED_STATUSES } from '../orderViews'
import { opsDayOf, opsDayRange, opsDaysRange } from '../opsDay'

/**
 * THE rider record: what a rider did in a reporting day, counted one way.
 *
 * The rider app and the admin's Riders page used to answer "how many orders
 * did this rider do today" with two different queries. The app counted orders
 * CLOSED on a calendar day; the admin counted orders whose TRAIN was booked
 * for that date, included the one still in hand, and added up the bill of
 * every COD order carried whether or not it was delivered. Both were
 * defensible and they could not agree: a night shift's orders belong to
 * yesterday's trains and today's clock.
 *
 * Everything that shows a rider's day now reads this file: the app's Done
 * tab, the team leader's view, the admin's board and the rider's page. One
 * definition each of
 *
 * - whose order it is: the rider who picked it up, or, before anyone has,
 *   everyone it was offered to (onRiderRecord)
 * - which day it falls in: the 3am-to-3am reporting day in which it CLOSED
 *   (lib/opsDay), because that is when the work and the cash happened
 * - what counts as done: delivered or not delivered, plus anything else that
 *   closed after the rider had already picked it up. An order the office
 *   cancelled while it was still cooking was never in the rider's hands and
 *   is not their work
 * - what the cash is: what was recorded at the door on DELIVERED COD orders.
 *   A COD order that was not delivered collected nothing
 *
 * An order still in the rider's hands is not part of any day yet. It is
 * reported beside the day's figures as "in hand", never inside them.
 */

const NOT_DELIVERED = ['FAILED', 'MISSED_DELIVERY', 'MISDELIVERY']

/** Closed within [from, to), for orders with and without `delivery.closedAt`. */
export function closedBetween(from: Date, to: Date): QueryFilter<OrderDoc> {
  return {
    $or: [
      { 'delivery.closedAt': { $gte: from, $lt: to } },
      { 'delivery.closedAt': null, 'delivery.deliveredAt': { $gte: from, $lt: to } },
      { 'delivery.closedAt': null, 'delivery.deliveredAt': null, updatedAt: { $gte: from, $lt: to } },
    ],
  }
}

/**
 * Finished orders that belong in a rider's record.
 *
 * `outcomes: 'legacy'` keeps to DELIVERED and FAILED, for app builds that
 * draw every other row as delivered; `'cancelled'` adds office cancellations
 * the rider carried, for builds that know the word; `'all'` adds every other
 * closing status reached after pickup (missed the train, wrong passenger,
 * refunded), which is what the record really is.
 */
export function riderDoneFilter(outcomes: 'legacy' | 'cancelled' | 'all' = 'all'): QueryFilter<OrderDoc> {
  const closed = { status: { $in: ['DELIVERED', 'FAILED'] } }
  if (outcomes === 'legacy') return closed
  const carried =
    outcomes === 'cancelled'
      ? ['CANCELLED']
      : OVERALL_CANCELLED_STATUSES.filter((s) => s !== 'FAILED')
  return { $or: [closed, { status: { $in: carried }, 'delivery.dispatchedAt': { $ne: null } }] }
}

/** Everything one rider finished inside an instant range: the list behind the day's figures. */
export function riderDoneBetween(
  riderId: mongoose.Types.ObjectId,
  range: { from: Date; to: Date },
  outcomes: 'legacy' | 'cancelled' | 'all' = 'all',
): QueryFilter<OrderDoc> {
  return { $and: [riderDoneFilter(outcomes), onRiderRecord(riderId), closedBetween(range.from, range.to)] }
}

export type RiderDay = {
  /** Finished in the day: delivered + notDelivered + cancelled. */
  done: number
  delivered: number
  /** The rider reached the end of the job without handing it over. */
  notDelivered: number
  /** Called off by the office after the rider had it. */
  cancelled: number
  /** Delivered cash-on-delivery orders, and the cash recorded on them. */
  codOrders: number
  codPaise: number
  /** Delivered orders already paid for. */
  prepaidOrders: number
  /** The bill value of everything delivered, cash or not. */
  deliveredPaise: number
  /** The bill value of everything finished in the day, delivered or not. */
  amountPaise: number
  lastDeliveredAt: string | null
  stations: string[]
}

export type RiderNow = {
  /** In the rider's hands this minute, whatever day they were picked up. */
  inHand: number
  /** Given to the rider and not picked up yet. */
  waiting: number
  /** Trains they are carrying food for right now. */
  trains: string[]
  /** Cash to collect on what is in hand. */
  inHandCodPaise: number
}

export const NO_RIDER_DAY: RiderDay = {
  done: 0, delivered: 0, notDelivered: 0, cancelled: 0, codOrders: 0, codPaise: 0,
  prepaidOrders: 0, deliveredPaise: 0, amountPaise: 0, lastDeliveredAt: null, stations: [],
}
export const NO_RIDER_NOW: RiderNow = { inHand: 0, waiting: 0, trains: [], inHandCodPaise: 0 }

/** Adds the rider (or riders) an order is on the record of, as `_rider`, one row each. */
const ATTRIBUTE = [
  {
    $addFields: {
      _rider: {
        $cond: [
          { $ne: [{ $ifNull: ['$delivery.pickedUpBy', null] }, null] },
          ['$delivery.pickedUpBy'],
          { $ifNull: ['$delivery.agentIds', []] },
        ],
      },
    },
  },
  { $unwind: '$_rider' },
]

const CASH = { $ifNull: ['$delivery.amountCollectedPaise', { $ifNull: ['$amountPaise', 0] }] }
const BILL = { $ifNull: ['$amountPaise', 0] }
const IS = (status: string | string[]) =>
  Array.isArray(status) ? { $in: ['$status', status] } : { $eq: ['$status', status] }
const AND = (...c: unknown[]) => ({ $and: c })
const COUNT = (c: unknown) => ({ $sum: { $cond: [c, 1, 0] } })
const SUM = (c: unknown, v: unknown) => ({ $sum: { $cond: [c, v, 0] } })

/**
 * What each rider finished inside [from, to). The caller passes rider ids it
 * has checked this user may read (see outletScoped).
 */
export async function riderDays(
  ctx: AuthContext,
  riderIds: mongoose.Types.ObjectId[],
  range: { from: Date; to: Date },
): Promise<Map<string, RiderDay>> {
  const out = new Map<string, RiderDay>()
  if (riderIds.length === 0) return out
  await connectDb()

  const delivered = IS('DELIVERED')
  const cod = { $eq: ['$paymentMode', 'COD'] }
  const rows = await Order.aggregate<Omit<RiderDay, 'lastDeliveredAt' | 'stations'> & {
    _id: mongoose.Types.ObjectId
    lastDeliveredAt: Date | null
    stations: string[]
  }>([
    {
      $match: outletScoped(ctx, {
        $and: [riderDoneFilter('all'), onRiderRecord(riderIds), closedBetween(range.from, range.to)],
      }),
    },
    ...ATTRIBUTE,
    { $match: { _rider: { $in: riderIds } } },
    {
      $group: {
        _id: '$_rider',
        done: { $sum: 1 },
        delivered: COUNT(delivered),
        notDelivered: COUNT(IS(NOT_DELIVERED)),
        cancelled: COUNT({ $not: [{ $or: [delivered, IS(NOT_DELIVERED)] }] }),
        codOrders: COUNT(AND(delivered, cod)),
        codPaise: SUM(AND(delivered, cod), CASH),
        prepaidOrders: COUNT(AND(delivered, { $not: [cod] })),
        deliveredPaise: SUM(delivered, BILL),
        amountPaise: { $sum: BILL },
        lastDeliveredAt: { $max: '$delivery.deliveredAt' },
        stations: { $push: '$stationCode' },
      },
    },
  ])
  for (const { _id, lastDeliveredAt, stations, ...r } of rows) {
    out.set(String(_id), {
      ...r,
      lastDeliveredAt: lastDeliveredAt ? lastDeliveredAt.toISOString() : null,
      stations: byFrequency(stations),
    })
  }
  return out
}

/** What each rider is holding and waiting on right now. Not bounded by a day. */
export async function ridersNow(
  ctx: AuthContext,
  riderIds: mongoose.Types.ObjectId[],
): Promise<Map<string, RiderNow>> {
  const out = new Map<string, RiderNow>()
  if (riderIds.length === 0) return out
  await connectDb()

  const out_ = IS('DISPATCHED')
  const rows = await Order.aggregate<{
    _id: mongoose.Types.ObjectId
    inHand: number
    waiting: number
    trains: (string | null)[]
    inHandCodPaise: number
  }>([
    {
      $match: outletScoped(ctx, {
        $and: [
          { status: { $in: ['RECEIVED', 'ACCEPTED', 'KOT_PRINTED', 'PREPARED', 'DISPATCHED'] } },
          onRiderRecord(riderIds),
        ],
      }),
    },
    ...ATTRIBUTE,
    { $match: { _rider: { $in: riderIds } } },
    {
      $group: {
        _id: '$_rider',
        inHand: COUNT(out_),
        waiting: COUNT({ $not: [out_] }),
        trains: { $push: { $cond: [out_, '$trainNo', null] } },
        inHandCodPaise: SUM(AND(out_, { $eq: ['$paymentMode', 'COD'] }), BILL),
      },
    },
  ])
  for (const r of rows) {
    out.set(String(r._id), {
      inHand: r.inHand,
      waiting: r.waiting,
      trains: [...new Set(r.trains.filter((t): t is string => Boolean(t)))].sort(),
      inHandCodPaise: r.inHandCodPaise,
    })
  }
  return out
}

/**
 * One count per order across several riders, for a board's headline. Adding
 * the riders' rows up would count an order still offered to two riders twice.
 */
export async function ridersDayTotal(
  ctx: AuthContext,
  riderIds: mongoose.Types.ObjectId[],
  range: { from: Date; to: Date },
): Promise<Omit<RiderDay, 'lastDeliveredAt' | 'stations'>> {
  const { lastDeliveredAt: _l, stations: _s, ...zero } = NO_RIDER_DAY
  void _l
  void _s
  if (riderIds.length === 0) return zero
  await connectDb()
  const delivered = IS('DELIVERED')
  const cod = { $eq: ['$paymentMode', 'COD'] }
  const [row] = await Order.aggregate<typeof zero>([
    {
      $match: outletScoped(ctx, {
        $and: [riderDoneFilter('all'), onRiderRecord(riderIds), closedBetween(range.from, range.to)],
      }),
    },
    {
      $group: {
        _id: null,
        done: { $sum: 1 },
        delivered: COUNT(delivered),
        notDelivered: COUNT(IS(NOT_DELIVERED)),
        cancelled: COUNT({ $not: [{ $or: [delivered, IS(NOT_DELIVERED)] }] }),
        codOrders: COUNT(AND(delivered, cod)),
        codPaise: SUM(AND(delivered, cod), CASH),
        prepaidOrders: COUNT(AND(delivered, { $not: [cod] })),
        deliveredPaise: SUM(delivered, BILL),
        amountPaise: { $sum: BILL },
      },
    },
    { $project: { _id: 0 } },
  ])
  return row ?? zero
}

/** A reporting-day span ('YYYY-MM-DD' to 'YYYY-MM-DD', inclusive) as instants. Blank ends are open. */
export function opsSpan(from: string, to: string, now: Date = new Date()): { from: Date; to: Date } {
  const today = opsDayOf(now)
  const range = opsDaysRange(from || '2020-01-01', to || today)
  return range ?? opsDayRange(today)!
}

/** Distinct values, most frequent first, ties alphabetical. */
function byFrequency(values: string[]): string[] {
  const count = new Map<string, number>()
  for (const v of values) if (v) count.set(v, (count.get(v) ?? 0) + 1)
  return [...count.keys()].sort((a, b) => count.get(b)! - count.get(a)! || a.localeCompare(b))
}
