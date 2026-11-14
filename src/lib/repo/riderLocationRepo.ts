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
import { opsDayOf, opsDayRange } from '../opsDay'
import {
  NO_RIDER_DAY, NO_RIDER_NOW, riderDays, ridersDayTotal, ridersNow, type RiderDay, type RiderNow,
} from './riderLedgerRepo'
import { pendingCashByRider, type PendingCash } from './riderCashRepo'
import { scoped } from './orderRepo'
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
  isTeamLead: boolean
  teamLeadId: string | null
  work: {
    /** In their hands right now. Zero when looking at a past day. */
    carrying: number
    /** Marked out for them over a day and a half ago, never closed. Not in anyone's hands. */
    stale: number
    delivered: number
    /** Finished without a delivery: not delivered plus cancelled after pickup. */
    failed: number
    notDelivered: number
    cancelled: number
    /** Trains this rider is carrying food for right now, most orders first. */
    trains: string[]
    lastDeliveredAt: string | null
    /** Everything finished in the reporting day, the same count as `done`. */
    orders: number
    /**
     * Orders booked for this date that they are on, whatever became of them:
     * the count Analytics and All orders give for this rider and this date.
     */
    booked: number
    /** Finished in the reporting day: what the rider's own app counts. */
    done: number
    /** Delivered cash-on-delivery orders in the day. */
    codOrders: number
    /** Paise. Cash recorded on those deliveries. */
    codPaise: number
    /** Paise. The bill value of everything finished in the day. */
    amountPaise: number
    /** Paise and orders. COD cash delivered in the day and not yet received. */
    duePaise: number
    dueOrders: number
    /** The same, delivered before the day began and still not received. */
    earlierDuePaise: number
    earlierDueOrders: number
    /** Stations they worked in the day, busiest first. Empty on a day off. */
    stations: string[]
  }
}

/**
 * The day's riders' work, counted per order rather than summed per rider: an
 * order still offered to two riders is one order and one amount, where
 * adding up the rows would count it twice.
 */
export type RiderTotals = {
  /** Finished in the day. Same as `done`. */
  orders: number
  done: number
  inHand: number
  delivered: number
  notDelivered: number
  cancelled: number
  codOrders: number
  codPaise: number
  amountPaise: number
  duePaise: number
  dueOrders: number
}

/**
 * The orders booked for the date, the same set Analytics and All orders
 * count (see "What counts" in lib/analytics): every order with that
 * `serviceDate`, rating decoys aside, split by whether a rider is on it.
 * `orders + unassignedOrders === dayOrders`, exactly.
 *
 * This is a different question from RiderTotals. That one asks what riders
 * finished between 3am and 3am, and is what a rider's app shows; this one
 * asks what was booked for the date, and is what the office's other screens
 * show. The board shows both, each under its own name.
 */
export type DayTotals = {
  /** Booked orders with a rider on them. */
  orders: number
  codOrders: number
  codPaise: number
  amountPaise: number
  /** Every order booked for the day, rating decoys aside. */
  dayOrders: number
  dayAmountPaise: number
  dayCodOrders: number
  dayCodPaise: number
  /** Booked orders nobody has been put on yet. */
  unassignedOrders: number
  unassignedPaise: number
}

function workOf(
  day: RiderDay,
  now: RiderNow,
  due: PendingCash | undefined,
  earlier: PendingCash | undefined,
  booked = 0,
): RiderView['work'] {
  return {
    carrying: now.inHand,
    stale: now.stale,
    delivered: day.delivered,
    failed: day.notDelivered + day.cancelled,
    notDelivered: day.notDelivered,
    cancelled: day.cancelled,
    trains: now.trains,
    lastDeliveredAt: day.lastDeliveredAt,
    orders: day.done,
    booked,
    done: day.done,
    codOrders: day.codOrders,
    codPaise: day.codPaise,
    amountPaise: day.amountPaise,
    duePaise: due?.paise ?? 0,
    dueOrders: due?.orders ?? 0,
    earlierDuePaise: earlier?.paise ?? 0,
    earlierDueOrders: earlier?.orders ?? 0,
    stations: day.stations,
  }
}

export type RiderBoard = {
  serviceDate: string
  fetchedAt: string
  riders: RiderView[]
  /** What riders finished in the 3am to 3am day: the rider ledger. */
  totals: RiderTotals
  /** What was booked for the date, as Analytics and All orders count it. */
  day: DayTotals
  /**
   * What is left over from before the day began, kept out of the day's
   * figures and shown beside them: orders riders still hold (only knowable for
   * today, so null for a past day) and COD cash delivered earlier and still
   * not received.
   */
  carried: Carried
}

export type Carried = {
  /** Still out with a rider, picked up before this day began. */
  openOrders: number | null
  /** Marked out for a rider long ago and never closed: stale records, not food in hands. */
  staleOrders: number
  cashPaise: number
  cashOrders: number
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
  const serviceDate = opts.serviceDate ?? opsDayOf(now)

  await connectDb()
  const [active, booked, day] = await Promise.all([
    User.find({ role: 'DELIVERY_AGENT', active: true })
      .select('name phone isTeamLead teamLeadId')
      .sort({ name: 1 })
      .lean(),
    bookedByRider(ctx, serviceDate),
    bookedTotals(ctx, serviceDate),
  ])

  // A rider switched off since still carried what they carried: listed on the
  // days they worked, so their orders are not counted in the totals but
  // missing from every row.
  const listed = new Set(active.map((r) => String(r._id)))
  const missing = [...booked.keys()].filter((id) => !listed.has(id) && mongoose.isValidObjectId(id))
  const inactive = missing.length
    ? await User.find({ _id: { $in: missing }, role: 'DELIVERY_AGENT' })
        .select('name phone isTeamLead teamLeadId')
        .lean()
    : []
  const riders = [...active, ...inactive]

  const ids = riders.map((r) => r._id)
  if (ids.length === 0) {
    return { serviceDate, fetchedAt: now.toISOString(), riders: [], totals: NO_TOTALS, day, carried: NO_CARRIED }
  }

  // One reporting day, 3am to 3am, read from the rider ledger: the same
  // source and the same boundary the rider's own app uses, so a rider and an
  // admin looking at the same day see the same numbers.
  const range = opsDayRange(serviceDate) ?? opsDayRange(opsDayOf(now))!
  const isToday = serviceDate === opsDayOf(now)
  const [locations, days, nows, dues, earlierDues, total] = await Promise.all([
    RiderLocation.find({ userId: { $in: ids } }).lean(),
    riderDays(ctx, ids, range),
    // What is in a rider's hands is a fact about now, not about a past day.
    isToday ? ridersNow(ctx, ids, range.from) : Promise.resolve(new Map<string, RiderNow>()),
    // Cash from the day, and cash from before it that is still out, apart.
    pendingCashByRider(ctx, ids, { from: range.from, to: range.to }),
    pendingCashByRider(ctx, ids, { to: range.from }),
    ridersDayTotal(ctx, ids, range),
  ])
  const work = new Map(
    ids.map((id) => {
      const key = String(id)
      return [
        key,
        workOf(
          days.get(key) ?? NO_RIDER_DAY,
          nows.get(key) ?? NO_RIDER_NOW,
          dues.get(key),
          earlierDues.get(key),
          booked.get(key) ?? 0,
        ),
      ] as const
    }),
  )
  const inHand = [...nows.values()].reduce((a, n) => a + n.inHand, 0)
  const totals: RiderTotals = {
    orders: total.done,
    done: total.done,
    inHand,
    delivered: total.delivered,
    notDelivered: total.notDelivered,
    cancelled: total.cancelled,
    codOrders: total.codOrders,
    codPaise: total.codPaise,
    amountPaise: total.amountPaise,
    duePaise: [...dues.values()].reduce((a, d) => a + d.paise, 0),
    dueOrders: [...dues.values()].reduce((a, d) => a + d.orders, 0),
  }

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
      isTeamLead: rider.isTeamLead === true,
      teamLeadId: rider.teamLeadId ? String(rider.teamLeadId) : null,
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

  const carried: Carried = {
    openOrders: isToday ? [...nows.values()].reduce((a, n) => a + n.inHandBefore, 0) : null,
    staleOrders: isToday ? [...nows.values()].reduce((a, n) => a + n.stale, 0) : 0,
    cashPaise: [...earlierDues.values()].reduce((a, d) => a + d.paise, 0),
    cashOrders: [...earlierDues.values()].reduce((a, d) => a + d.orders, 0),
  }

  return { serviceDate, fetchedAt: now.toISOString(), riders: rows, totals, day, carried }
}

const NO_WORK: RiderView['work'] = workOf(NO_RIDER_DAY, NO_RIDER_NOW, undefined, undefined)

const NO_CARRIED: Carried = { openOrders: null, staleOrders: 0, cashPaise: 0, cashOrders: 0 }

const NO_TOTALS: RiderTotals = {
  orders: 0, done: 0, inHand: 0, delivered: 0, notDelivered: 0, cancelled: 0,
  codOrders: 0, codPaise: 0, amountPaise: 0, duePaise: 0, dueOrders: 0,
}

const NO_DAY: DayTotals = {
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
/** Any rider on the order, at any status. */
const HAS_RIDER = { $gt: [{ $size: { $ifNull: ['$delivery.agentIds', []] } }, 0] }

/** The booked day's totals, one count per order, split by whether a rider is on it. */
async function bookedTotals(ctx: AuthContext, serviceDate: string): Promise<DayTotals> {
  const ridden = (expr: unknown) => ({ $cond: [HAS_RIDER, expr, 0] })
  const [row] = await Order.aggregate<DayTotals>([
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
  if (!row) return NO_DAY
  return {
    ...row,
    unassignedOrders: row.dayOrders - row.orders,
    unassignedPaise: row.dayAmountPaise - row.amountPaise,
  }
}

/**
 * How many of the day's booked orders each rider is on, whatever became of
 * them. A shared order counts for each rider on it, as in Analytics.
 */
async function bookedByRider(ctx: AuthContext, serviceDate: string): Promise<Map<string, number>> {
  const rows = await Order.aggregate<{ _id: mongoose.Types.ObjectId; orders: number }>([
    { $match: { $and: [dayMatch(ctx, serviceDate), { 'delivery.agentIds.0': { $exists: true } }] } },
    { $unwind: '$delivery.agentIds' },
    { $group: { _id: '$delivery.agentIds', orders: { $sum: 1 } } },
  ])
  return new Map(rows.map((r) => [String(r._id), r.orders]))
}
