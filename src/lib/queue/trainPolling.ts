import { connectDb } from '../db'
import { Restaurant, TrainStatus } from '../models'
import { systemFindActiveTrainGroups, systemRecordLeaveNow } from '../repo/orderRepo'
import { todayIST } from '../format'
import { refreshTrainStatus, readCachedStatus } from '../train/service'
import { computeDispatchAt, isStale, minutesBetween } from '../train/policy'
import { env } from '../env'
import type { OrderStatus } from '../orderStatus'

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
  const serviceDate = todayIST()

  // Plan §8: only poll trains with at least one active order today.
  const groups = await systemFindActiveTrainGroups(serviceDate, ACTIVE_STATUSES)

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
      serviceDate,
      stationCode: g._id.stationCode,
    }

    const cachedRow = await readCachedStatus(key)
    const target = cachedRow?.etaAt ?? g.scheduledArrival ?? null
    const minutesToArrival = target ? minutesBetween(now, target) : null

    let row = cachedRow
    if (isStale(cachedRow?.fetchedAt ?? null, minutesToArrival, now)) {
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
