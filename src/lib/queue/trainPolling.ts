import { connectDb } from '../db'
import { Restaurant, TrainStatus } from '../models'
import { systemFindActiveTrainGroups, systemRecordLeaveNow } from '../repo/orderRepo'
import { shiftServiceDate, todayIST } from '../format'
import { inRollover, rolloverCutoff } from '../liveDay'
import { refreshTrainStatus, readCachedStatus } from '../train/service'
import { computeDispatchAt, isStale, latchedForRun, minutesBetween } from '../train/policy'
import { env } from '../env'
import type { OrderStatus } from '../orderStatus'

/**
 * How far ahead tomorrow's bookings are polled from today. Wider than the
 * furthest a timetable is allowed to move a booking (6h, rescheduledArrival),
 * so the move is found while the train is still on its way.
 */
const TOMORROW_LOOKAHEAD_HOURS = 12

/** Orders that still have a delivery ahead of them are worth polling for. */
const ACTIVE_STATUSES: OrderStatus[] = [
  'RECEIVED', 'ACCEPTED', 'KOT_PRINTED', 'PREPARED', 'DISPATCHED',
]

export type PollSummary = {
  trainsConsidered: number
  refreshed: number
  skippedFresh: number
  failures: number
  leaveNowFired: string[]
}

/**
 * One scan of every train that needs attention today.
 *
 * Design note: rather than registering a repeatable job per train and
 * rescheduling it whenever the tier changes — which means constantly editing
 * the schedule as trains approach — this runs on a fixed one-minute tick and
 * lets pollIntervalMinutes() decide, per train, whether enough time has passed.
 * Same cadence as plan §8, far fewer moving parts, and the tier logic stays a
 * pure function that the tests already cover.
 */
export async function runTrainPollingTick(now = new Date()): Promise<PollSummary> {
  await connectDb()
  const today = todayIST()
  const tomorrow = shiftServiceDate(today, 1)

  // Plan §8: only poll trains with at least one active order today — plus
  // tomorrow's orders booked within the next few hours. A train booked for
  // 00:02 is on its way tonight, and its timetable may have it in before
  // midnight (15565 at CNB: booked 00:02 on the 30th, there at 23:40 on the
  // 29th). Left until the date rolls over, it would be polled only after it
  // had gone, and its order never moved onto the evening it really belongs to.
  const groups = [
    ...(await systemFindActiveTrainGroups(today, ACTIVE_STATUSES)).map((g) => ({ ...g, serviceDate: today })),
    ...(
      await systemFindActiveTrainGroups(tomorrow, ACTIVE_STATUSES, {
        bookedBefore: new Date(now.getTime() + TOMORROW_LOOKAHEAD_HOURS * 3_600_000),
      })
    ).map((g) => ({ ...g, serviceDate: tomorrow })),
    // And past midnight, last night's open orders the live board still
    // carries (liveDay.ts) — a 23:40 train running late is still coming.
    ...(inRollover(now)
      ? (
          await systemFindActiveTrainGroups(shiftServiceDate(today, -1), ACTIVE_STATUSES, {
            bookedFrom: rolloverCutoff(now),
          })
        ).map((g) => ({ ...g, serviceDate: shiftServiceDate(today, -1) }))
      : []),
  ]

  const summary: PollSummary = {
    trainsConsidered: groups.length,
    refreshed: 0,
    skippedFresh: 0,
    failures: 0,
    leaveNowFired: [],
  }

  for (const g of groups) {
    const key = {
      trainNo: g._id.trainNo,
      serviceDate: g.serviceDate,
      stationCode: g._id.stationCode,
    }

    const cachedRow = await readCachedStatus(key)
    const target = cachedRow?.etaAt ?? g.scheduledArrival ?? null
    const minutesToArrival = target ? minutesBetween(now, target) : null

    let row = cachedRow
    if (
      isStale(
        cachedRow?.fetchedAt ?? null,
        minutesToArrival,
        now,
        latchedForRun(cachedRow, g.scheduledArrival),
        cachedRow?.lastError != null,
      )
    ) {
      row = await refreshTrainStatus(key, { scheduledArrival: g.scheduledArrival })
      if (row.lastError) summary.failures += 1
      else summary.refreshed += 1
    } else {
      summary.skippedFresh += 1
    }

    // --- leave-now (plan §9) -------------------------------------------
    // Only meaningful once something on the run is actually PREPARED.
    if (!g.statuses.includes('PREPARED')) continue

    const walk = await Restaurant.findOne({ _id: { $in: g.restaurantIds } })
      .select('walkToPlatformMinutes')
      .lean()

    const dispatchAt = computeDispatchAt({
      etaAt: row?.etaAt ?? g.scheduledArrival ?? null,
      walkToPlatformMinutes: walk?.walkToPlatformMinutes ?? 10,
      bufferMinutes: env.DISPATCH_BUFFER_MINUTES,
    })
    if (!dispatchAt || dispatchAt > now) continue

    // No FCM in this build, so the alert is recorded on the order's own event
    // log. That gives the audit trail a push would have left, and the agent UI
    // reads the same computation live.
    const notified = await systemRecordLeaveNow(
      g.orderIds,
      {
        trainNo: key.trainNo,
        platform: row?.platform ?? null,
        etaAt: row?.etaAt ?? null,
        delayMinutes: row?.delayMinutes ?? null,
      },
      now,
    )
    if (notified > 0) {
      summary.leaveNowFired.push(`${key.trainNo}@${key.stationCode} (${notified})`)
    }
  }

  return summary
}

/** Removes cache rows for days gone by, so the collection does not grow forever. */
export async function pruneOldTrainStatuses(keepDays = 7): Promise<number> {
  await connectDb()
  const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000)
  const { deletedCount } = await TrainStatus.deleteMany({ fetchedAt: { $lt: cutoff } })
  return deletedCount ?? 0
}
