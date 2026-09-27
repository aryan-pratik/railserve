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
  }
}

export type RiderBoard = {
  serviceDate: string
  fetchedAt: string
  riders: RiderView[]
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
  const riders = await User.find({ role: 'DELIVERY_AGENT', active: true })
    .select('name phone')
    .sort({ name: 1 })
    .lean()

  const ids = riders.map((r) => r._id)
  if (ids.length === 0) {
    return { serviceDate, fetchedAt: now.toISOString(), riders: [] }
  }

  const [locations, work] = await Promise.all([
    RiderLocation.find({ userId: { $in: ids } }).lean(),
    workByRider(ctx, ids, serviceDate),
  ])

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
      work: w ?? { carrying: 0, delivered: 0, failed: 0, trains: [], lastDeliveredAt: null },
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

  return { serviceDate, fetchedAt: now.toISOString(), riders: rows }
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
  ids: mongoose.Types.ObjectId[],
  serviceDate: string,
): Promise<Map<string, RiderView['work']>> {
  const rows = await Order.aggregate<{
    _id: mongoose.Types.ObjectId
    carrying: number
    delivered: number
    failed: number
    lastDeliveredAt: Date | null
    trains: (string | null)[]
  }>([
    {
      $match: scoped(ctx, {
        serviceDate,
        'delivery.agentIds': { $in: ids },
        status: { $in: ['DISPATCHED', 'DELIVERED', 'FAILED'] },
      }),
    },
    { $unwind: '$delivery.agentIds' },
    { $match: { 'delivery.agentIds': { $in: ids } } },
    {
      $group: {
        _id: '$delivery.agentIds',
        carrying: { $sum: { $cond: [{ $eq: ['$status', 'DISPATCHED'] }, 1, 0] } },
        delivered: { $sum: { $cond: [{ $eq: ['$status', 'DELIVERED'] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ['$status', 'FAILED'] }, 1, 0] } },
        lastDeliveredAt: { $max: '$delivery.deliveredAt' },
        // Only what is still in their hands: the trains they have already
        // served are not where they are going next.
        trains: {
          $push: { $cond: [{ $eq: ['$status', 'DISPATCHED'] }, '$trainNo', null] },
        },
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
      },
    ]),
  )
}
