import mongoose from 'mongoose'
import { RiderLocation, User } from '../models'
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
    delivered: number
    /** Finished without a delivery: not delivered plus cancelled after pickup. */
    failed: number
    notDelivered: number
    cancelled: number
    /** Trains this rider is carrying food for right now, most orders first. */
    trains: string[]
    lastDeliveredAt: string | null
    /** Everything finished in the reporting day, plus what is in hand now. */
    orders: number
    /** Finished in the reporting day: what the rider's own app counts. */
    done: number
    /** Delivered cash-on-delivery orders in the day. */
    codOrders: number
    /** Paise. Cash recorded on those deliveries. */
    codPaise: number
    /** Paise. The bill value of everything finished in the day. */
    amountPaise: number
    /** Paise and orders. Delivered COD cash not yet received, across all days. */
    duePaise: number
    dueOrders: number
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

function workOf(day: RiderDay, now: RiderNow, due: PendingCash | undefined): RiderView['work'] {
  return {
    carrying: now.inHand,
    delivered: day.delivered,
    failed: day.notDelivered + day.cancelled,
    notDelivered: day.notDelivered,
    cancelled: day.cancelled,
    trains: now.trains,
    lastDeliveredAt: day.lastDeliveredAt,
    orders: day.done + now.inHand,
    done: day.done,
    codOrders: day.codOrders,
    codPaise: day.codPaise,
    amountPaise: day.amountPaise,
    duePaise: due?.paise ?? 0,
    dueOrders: due?.orders ?? 0,
    stations: day.stations,
  }
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
  const serviceDate = opts.serviceDate ?? opsDayOf(now)

  await connectDb()
  const riders = await User.find({ role: 'DELIVERY_AGENT', active: true })
    .select('name phone isTeamLead teamLeadId')
    .sort({ name: 1 })
    .lean()

  const ids = riders.map((r) => r._id)
  if (ids.length === 0) {
    return { serviceDate, fetchedAt: now.toISOString(), riders: [], totals: NO_TOTALS }
  }

  // One reporting day, 3am to 3am, read from the rider ledger: the same
  // source and the same boundary the rider's own app uses, so a rider and an
  // admin looking at the same day see the same numbers.
  const range = opsDayRange(serviceDate) ?? opsDayRange(opsDayOf(now))!
  const isToday = serviceDate === opsDayOf(now)
  const [locations, days, nows, dues, total] = await Promise.all([
    RiderLocation.find({ userId: { $in: ids } }).lean(),
    riderDays(ctx, ids, range),
    // What is in a rider's hands is a fact about now, not about a past day.
    isToday ? ridersNow(ctx, ids) : Promise.resolve(new Map<string, RiderNow>()),
    pendingCashByRider(ctx, ids),
    ridersDayTotal(ctx, ids, range),
  ])
  const work = new Map(
    ids.map((id) => {
      const key = String(id)
      return [key, workOf(days.get(key) ?? NO_RIDER_DAY, nows.get(key) ?? NO_RIDER_NOW, dues.get(key))] as const
    }),
  )
  const inHand = [...nows.values()].reduce((a, n) => a + n.inHand, 0)
  const totals: RiderTotals = {
    orders: total.done + inHand,
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

  return { serviceDate, fetchedAt: now.toISOString(), riders: rows, totals }
}

const NO_WORK: RiderView['work'] = workOf(NO_RIDER_DAY, NO_RIDER_NOW, undefined)

const NO_TOTALS: RiderTotals = {
  orders: 0, done: 0, inHand: 0, delivered: 0, notDelivered: 0, cancelled: 0,
  codOrders: 0, codPaise: 0, amountPaise: 0, duePaise: 0, dueOrders: 0,
}
