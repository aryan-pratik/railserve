import mongoose from 'mongoose'
import { Order, RiderLocation, User } from '../models'
import { connectDb } from '../db'
import type { AuthContext } from '../authContext'
import {
  MAX_CLOCK_SKEW_MINUTES,
  MAX_PING_AGE_MINUTES,
  TRAIL_MAX_POINTS,
  presenceOf,
  type LocationFix,
  type Presence,
} from '../riderLocation'
import { scoped } from './orderRepo'
import { todayIST } from '../format'
import { EXCLUDED_STATUS } from '../analytics'

/**
 * Reads and writes of where riders are.
 *
 * Lives beside the order repository, and reaches the Order model through that
 * file's `scoped()` rather than querying it raw, so the outlet-isolation rule
 * the ESLint guard enforces holds for the order side: the work counts shown
 * against a rider are the caller's own outlets' work, not every outlet's.
 *
 * The roster itself is not scoped — every active rider is listed, whoever is
 * asking. That is correct only because `riderBoard` is ADMIN-only, whose scope
 * is everything anyway. Opening this board to a store manager would need the
 * User query narrowed to riders at their outlets first; nothing here would
 * stop it leaking otherwise.
 */

/**
 * Take a batch of fixes from one rider's phone.
 *
 * Idempotent and order-independent, because the phone's queue is neither. A
 * rider walks into a station, loses signal for four minutes, and the app
 * flushes a dozen backed-up fixes the moment it comes out again — possibly
 * twice, if the first attempt timed out after the server had already written
 * it. So the stored position only ever moves forward in device time, and a
 * replayed or late batch is dropped rather than rewinding a rider to where
 * they were four minutes ago.
 *
 * Returns what was actually stored, so the route can say so honestly.
 */
export async function recordFixes(
  userId: mongoose.Types.ObjectId,
  fixes: LocationFix[],
  now: Date = new Date(),
): Promise<{ accepted: number; storedAt: Date | null }> {
  const usable = sanitise(fixes, now)
  if (usable.length === 0) return { accepted: 0, storedAt: null }

  const newest = usable[usable.length - 1]
  const points = usable.map((f) => ({ lat: f.lat, lng: f.lng, at: f.recordedAt }))

  await connectDb()

  // Two writes rather than a read-then-write, so two batches arriving at once
  // cannot both decide they are the newest. The first creates the row if this
  // rider has never reported; the second advances it only on a strictly newer
  // stamp, which Mongo evaluates atomically against the stored value.
  await RiderLocation.updateOne(
    { userId },
    {
      $setOnInsert: {
        userId,
        lat: newest.lat,
        lng: newest.lng,
        accuracyMetres: newest.accuracyMetres,
        speedMetresPerSecond: newest.speedMetresPerSecond,
        headingDegrees: newest.headingDegrees,
        recordedAt: newest.recordedAt,
        receivedAt: now,
        trail: points.slice(-TRAIL_MAX_POINTS),
      },
    },
    { upsert: true },
  )

  await RiderLocation.updateOne(
    { userId, recordedAt: { $lt: newest.recordedAt } },
    {
      $set: {
        lat: newest.lat,
        lng: newest.lng,
        accuracyMetres: newest.accuracyMetres,
        speedMetresPerSecond: newest.speedMetresPerSecond,
        headingDegrees: newest.headingDegrees,
        recordedAt: newest.recordedAt,
        receivedAt: now,
      },
      $push: { trail: { $each: points, $slice: -TRAIL_MAX_POINTS } },
    },
  )

  // No modifiedCount check on purpose. Zero here means the row was either just
  // inserted by the call above (already carrying this batch) or is already
  // ahead of it — in every case the batch is settled and the phone should drop
  // it, so there is nothing for the caller to distinguish.
  return { accepted: usable.length, storedAt: newest.recordedAt }
}

/**
 * Throw away what should never be stored, and put the rest in time order.
 *
 * Every one of these has a real cause. A phone with a wrong clock stamps a fix
 * in the future, and a future stamp would wedge the row forever — nothing
 * newer could ever arrive — so it is pulled back to now rather than rejected,
 * because the position itself is fine. A phone that was switched off overnight
 * flushes yesterday's walk, which is dropped outright. A fix with no satellite
 * lock comes through as (0, 0), which is in the Gulf of Guinea.
 */
function sanitise(fixes: LocationFix[], now: Date): LocationFix[] {
  const skewLimit = now.getTime() + MAX_CLOCK_SKEW_MINUTES * 60_000
  const ageLimit = now.getTime() - MAX_PING_AGE_MINUTES * 60_000

  return fixes
    .filter(
      (f) =>
        Number.isFinite(f.lat) &&
        Number.isFinite(f.lng) &&
        Math.abs(f.lat) <= 90 &&
        Math.abs(f.lng) <= 180 &&
        // Null Island is a failed fix, not a place any rider is standing.
        !(f.lat === 0 && f.lng === 0),
    )
    .map((f) =>
      f.recordedAt.getTime() > skewLimit ? { ...f, recordedAt: new Date(now) } : f,
    )
    .filter((f) => f.recordedAt.getTime() >= ageLimit)
    .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime())
}

/** One rider as the admin board shows them. */
export type RiderView = {
  id: string
  name: string
  phone: string
  presence: Presence
  position: {
    lat: number
    lng: number
    accuracyMetres: number | null
    speedMetresPerSecond: number | null
    headingDegrees: number | null
    recordedAt: string
    receivedAt: string
  } | null
  /** Oldest first, so it can be drawn straight as a path. */
  trail: { lat: number; lng: number; at: string }[]
  work: {
    carrying: number
    delivered: number
    failed: number
    /** Trains this rider is carrying food for right now, most orders first. */
    trains: string[]
    lastDeliveredAt: string | null
    /** Every order of the day they are on, whatever became of it. */
    orders: number
    codOrders: number
    /** Paise. What they should have collected on COD orders today. */
    codPaise: number
    /** Paise. The value of everything they carried today. */
    amountPaise: number
    /** Stations they worked today, busiest first. Empty on a day off. */
    stations: string[]
  }
}

/**
 * The day's riders' work, counted per order rather than summed per rider: a
 * bulk handover carried by two riders is one order and one amount, where
 * adding up the rows would count it twice.
 *
 * Alongside it, the whole day, so the board can show that the two halves add
 * up: `orders + unassignedOrders === dayOrders`, the same day total Analytics
 * and All orders show.
 */
export type RiderTotals = {
  /** Orders with a rider on them (see RIDER_ORDER in lib/analytics). */
  orders: number
  codOrders: number
  codPaise: number
  amountPaise: number
  /** Every order for the day, rating decoys aside. */
  dayOrders: number
  dayAmountPaise: number
  dayCodOrders: number
  dayCodPaise: number
  /** Orders for the day nobody has been put on yet. */
  unassignedOrders: number
  unassignedPaise: number
}

export type RiderBoard = {
  serviceDate: string
  fetchedAt: string
  riders: RiderView[]
  totals: RiderTotals
}

/**
 * Every rider, where they are, and what they are carrying.
 *
 * Riders with no position are included rather than filtered out — a rider who
 * is not on the map is the most interesting row on this board, not the least,
 * and dropping them would make an unshared phone indistinguishable from a
 * rider who does not exist.
 */
export async function riderBoard(
  ctx: AuthContext,
  opts: { serviceDate?: string; now?: Date } = {},
): Promise<RiderBoard> {
  const now = opts.now ?? new Date()
  const serviceDate = opts.serviceDate ?? todayIST(now)

  await connectDb()
  const [active, work, totals] = await Promise.all([
    User.find({ role: 'DELIVERY_AGENT', active: true }).select('name phone').sort({ name: 1 }).lean(),
    workByRider(ctx, serviceDate),
    workTotals(ctx, serviceDate),
  ])

  // A rider switched off since still carried what they carried: listed on the
  // days they worked, so their orders are not counted in the totals but
  // missing from every row.
  const listed = new Set(active.map((r) => String(r._id)))
  const missing = [...work.keys()].filter((id) => !listed.has(id) && mongoose.isValidObjectId(id))
  const inactive = missing.length
    ? await User.find({ _id: { $in: missing }, role: 'DELIVERY_AGENT' }).select('name phone').lean()
    : []
  const riders = [...active, ...inactive]
  const ids = riders.map((r) => r._id)

  const locations = ids.length ? await RiderLocation.find({ userId: { $in: ids } }).lean() : []

  const locationOf = new Map(locations.map((l) => [String(l.userId), l]))

  const rows = riders.map((rider): RiderView => {
    const loc = locationOf.get(String(rider._id))
    const w = work.get(String(rider._id))

    return {
      id: String(rider._id),
      name: rider.name,
      phone: rider.phone,
      presence: presenceOf(loc?.recordedAt ?? null, now),
      position: loc
        ? {
            lat: loc.lat,
            lng: loc.lng,
            accuracyMetres: loc.accuracyMetres ?? null,
            speedMetresPerSecond: loc.speedMetresPerSecond ?? null,
            headingDegrees: loc.headingDegrees ?? null,
            recordedAt: loc.recordedAt.toISOString(),
            receivedAt: loc.receivedAt.toISOString(),
          }
        : null,
      trail: (loc?.trail ?? []).map((p) => ({
        lat: p.lat,
        lng: p.lng,
        at: p.at.toISOString(),
      })),
      work: w ?? NO_WORK,
    }
  })

  // Whoever needs looking at first: riders currently reporting, then the ones
  // carrying the most food, then by name. An idle rider with six orders in
  // their hands outranks a live one with none.
  const order: Record<Presence, number> = { LIVE: 0, IDLE: 1, OFFLINE: 2, NEVER: 3 }
  rows.sort(
    (a, b) =>
      order[a.presence] - order[b.presence] ||
      b.work.carrying - a.work.carrying ||
      a.name.localeCompare(b.name),
  )

  return { serviceDate, fetchedAt: now.toISOString(), riders: rows, totals }
}

const NO_WORK: RiderView['work'] = {
  carrying: 0,
  delivered: 0,
  failed: 0,
  trains: [],
  lastDeliveredAt: null,
  orders: 0,
  codOrders: 0,
  codPaise: 0,
  amountPaise: 0,
  stations: [],
}

const NO_TOTALS: RiderTotals = {
  orders: 0, codOrders: 0, codPaise: 0, amountPaise: 0,
  dayOrders: 0, dayAmountPaise: 0, dayCodOrders: 0, dayCodPaise: 0, unassignedOrders: 0, unassignedPaise: 0,
}

/**
 * The day's orders, the same set Analytics and All orders count: one service
 * date, rating decoys aside.
 */
function dayMatch(ctx: AuthContext, serviceDate: string) {
  return scoped(ctx, { serviceDate, status: { $ne: EXCLUDED_STATUS } })
}

const IS_COD = { $eq: ['$paymentMode', 'COD'] }
const AMOUNT = { $ifNull: ['$amountPaise', 0] }
/** RIDER_ORDER, as an expression: any rider on the order, at any status. */
const HAS_RIDER = { $gt: [{ $size: { $ifNull: ['$delivery.agentIds', []] } }, 0] }
const UNDELIVERED = ['FAILED', 'MISSED_DELIVERY', 'MISDELIVERY']

/** The day's totals, one count per order, split by whether a rider is on it. */
async function workTotals(ctx: AuthContext, serviceDate: string): Promise<RiderTotals> {
  const ridden = (expr: unknown) => ({ $cond: [HAS_RIDER, expr, 0] })
  const [row] = await Order.aggregate<RiderTotals>([
    { $match: dayMatch(ctx, serviceDate) },
    {
      $group: {
        _id: null,
        dayOrders: { $sum: 1 },
        dayAmountPaise: { $sum: AMOUNT },
        dayCodOrders: { $sum: { $cond: [IS_COD, 1, 0] } },
        dayCodPaise: { $sum: { $cond: [IS_COD, AMOUNT, 0] } },
        orders: { $sum: ridden(1) },
        codOrders: { $sum: ridden({ $cond: [IS_COD, 1, 0] }) },
        codPaise: { $sum: ridden({ $cond: [IS_COD, AMOUNT, 0] }) },
        amountPaise: { $sum: ridden(AMOUNT) },
      },
    },
    { $project: { _id: 0 } },
  ])
  if (!row) return NO_TOTALS
  return {
    ...row,
    unassignedOrders: row.dayOrders - row.orders,
    unassignedPaise: row.dayAmountPaise - row.amountPaise,
  }
}

/**
 * Today's work per rider, in one aggregate rather than a query each.
 *
 * `delivery.agentIds` is written when a rider takes an order off the counter,
 * so it says who is carrying it — the `agent_runs` index covers exactly this
 * shape. Scoped through the order repository's filter so a caller only ever
 * counts work at outlets they hold.
 */
async function workByRider(
  ctx: AuthContext,
  serviceDate: string,
): Promise<Map<string, RiderView['work']>> {
  const rows = await Order.aggregate<{
    _id: mongoose.Types.ObjectId
    carrying: number
    delivered: number
    failed: number
    lastDeliveredAt: Date | null
    trains: (string | null)[]
    orders: number
    codOrders: number
    codPaise: number
    amountPaise: number
    stations: string[]
  }>([
    { $match: { $and: [dayMatch(ctx, serviceDate), { 'delivery.agentIds.0': { $exists: true } }] } },
    { $unwind: '$delivery.agentIds' },
    {
      $group: {
        _id: '$delivery.agentIds',
        carrying: { $sum: { $cond: [{ $eq: ['$status', 'DISPATCHED'] }, 1, 0] } },
        delivered: { $sum: { $cond: [{ $eq: ['$status', 'DELIVERED'] }, 1, 0] } },
        // Every way an order can come back undelivered, as Analytics counts it.
        failed: { $sum: { $cond: [{ $in: ['$status', UNDELIVERED] }, 1, 0] } },
        lastDeliveredAt: { $max: '$delivery.deliveredAt' },
        // Only what is still in their hands: the trains they have already
        // served are not where they are going next.
        trains: {
          $push: { $cond: [{ $eq: ['$status', 'DISPATCHED'] }, '$trainNo', null] },
        },
        orders: { $sum: 1 },
        codOrders: { $sum: { $cond: [IS_COD, 1, 0] } },
        codPaise: { $sum: { $cond: [IS_COD, { $ifNull: ['$amountPaise', 0] }, 0] } },
        amountPaise: { $sum: { $ifNull: ['$amountPaise', 0] } },
        stations: { $push: '$stationCode' },
      },
    },
  ])

  return new Map(
    rows.map((r) => [
      String(r._id),
      {
        carrying: r.carrying,
        delivered: r.delivered,
        failed: r.failed,
        trains: [...new Set(r.trains.filter((t): t is string => Boolean(t)))].sort(),
        lastDeliveredAt: r.lastDeliveredAt ? r.lastDeliveredAt.toISOString() : null,
        orders: r.orders,
        codOrders: r.codOrders,
        codPaise: r.codPaise,
        amountPaise: r.amountPaise,
        stations: byFrequency(r.stations),
      },
    ]),
  )
}

/** Distinct values, most frequent first, ties alphabetical. */
function byFrequency(values: string[]): string[] {
  const count = new Map<string, number>()
  for (const v of values) if (v) count.set(v, (count.get(v) ?? 0) + 1)
  return [...count.keys()].sort((a, b) => count.get(b)! - count.get(a)! || a.localeCompare(b))
}
