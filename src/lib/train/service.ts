import { connectDb } from '../db'
import { TrainStatus, type TrainStatusDoc } from '../models'
import { getTrainStatusProvider } from './index'
import { TrainStatusUnavailable } from './provider'
import { buildTimingView, isStale, minutesBetween, type TimingView } from './policy'

export type TrainKey = { trainNo: string; serviceDate: string; stationCode: string }

export function trainCacheKey(k: TrainKey): string {
  return `${k.trainNo}|${k.serviceDate}|${k.stationCode}`
}

/**
 * Fetches from the provider and writes the cache row.
 *
 * On failure the previous values are preserved and only `lastError` and
 * `fetchedAt` move — plan §8 says degrade to the last known value and show its
 * age, never blank the screen and never present it as fresh.
 */
export async function refreshTrainStatus(
  key: TrainKey,
  opts: { scheduledArrival?: Date | null } = {},
): Promise<TrainStatusDoc> {
  await connectDb()

  const provider = getTrainStatusProvider(() => opts.scheduledArrival ?? null)
  const filter = {
    trainNo: key.trainNo,
    serviceDate: key.serviceDate,
    stationCode: key.stationCode.toUpperCase(),
  }
  const now = new Date()

  try {
    const reading = await provider.getStatus(key.trainNo, key.serviceDate, key.stationCode)
    const doc = await TrainStatus.findOneAndUpdate(
      filter,
      {
        $set: {
          ...reading,
          fetchedAt: now,
          lastSuccessAt: now,
          lastError: null,
          provider: provider.name,
        },
      },
      { upsert: true, returnDocument: 'after' },
    )
    return doc!
  } catch (err) {
    const message = err instanceof TrainStatusUnavailable ? err.message : 'train status fetch failed'
    const doc = await TrainStatus.findOneAndUpdate(
      filter,
      {
        // Only the attempt time and the error move. etaAt/delay/platform keep
        // whatever they last held.
        $set: { fetchedAt: now, lastError: message, provider: provider.name },
      },
      { upsert: true, returnDocument: 'after' },
    )
    return doc!
  }
}

/** Reads the cache without touching the provider. */
export async function readCachedStatus(key: TrainKey): Promise<TrainStatusDoc | null> {
  await connectDb()
  return TrainStatus.findOne({
    trainNo: key.trainNo,
    serviceDate: key.serviceDate,
    stationCode: key.stationCode.toUpperCase(),
  }).lean<TrainStatusDoc>()
}

/**
 * Cache-first read that refreshes only when the row has aged past its tier.
 *
 * Ten orders on one train share one row and therefore one provider call (§8).
 */
export async function getTrainStatus(
  key: TrainKey,
  opts: { scheduledArrival?: Date | null; allowFetch?: boolean } = {},
): Promise<TrainStatusDoc | null> {
  const cachedRow = await readCachedStatus(key)
  const now = new Date()

  const target = cachedRow?.etaAt ?? opts.scheduledArrival ?? null
  const minutesToArrival = target ? minutesBetween(now, target) : null

  if (cachedRow && !isStale(cachedRow.fetchedAt, minutesToArrival, now)) {
    return cachedRow
  }
  if (opts.allowFetch === false) return cachedRow

  return refreshTrainStatus(key, { scheduledArrival: opts.scheduledArrival })
}

/**
 * Timing view for a batch of orders, one provider call per distinct train.
 *
 * Orders with no train number are skipped entirely (§8) — there is nothing to
 * poll, and they stay on their scheduled time.
 */
export async function timingForOrders<
  T extends {
    trainNo?: string | null
    serviceDate: string
    stationCode: string
    scheduledArrival?: Date | null
  },
>(orders: T[], opts: { allowFetch?: boolean } = {}): Promise<Map<string, TimingView>> {
  const now = new Date()
  const byKey = new Map<string, { key: TrainKey; scheduledArrival: Date | null }>()

  for (const o of orders) {
    if (!o.trainNo) continue
    const key: TrainKey = {
      trainNo: o.trainNo,
      serviceDate: o.serviceDate,
      stationCode: o.stationCode,
    }
    const k = trainCacheKey(key)
    if (!byKey.has(k)) byKey.set(k, { key, scheduledArrival: o.scheduledArrival ?? null })
  }

  const out = new Map<string, TimingView>()

  await Promise.all(
    [...byKey.entries()].map(async ([k, { key, scheduledArrival }]) => {
      const row = await getTrainStatus(key, {
        scheduledArrival,
        allowFetch: opts.allowFetch,
      })
      out.set(
        k,
        buildTimingView({
          scheduledArrival,
          reading: row
            ? {
                etaAt: row.etaAt ?? null,
                delayMinutes: row.delayMinutes ?? null,
                platform: row.platform ?? null,
                fetchedAt: row.fetchedAt,
              }
            : null,
          now,
        }),
      )
    }),
  )

  return out
}

/** Timing for one order, or a scheduled-only view when it has no train number. */
export function timingFor<
  T extends { trainNo?: string | null; serviceDate: string; stationCode: string; scheduledArrival?: Date | null },
>(order: T, map: Map<string, TimingView>): TimingView {
  if (!order.trainNo) {
    return {
      effectiveArrival: order.scheduledArrival ?? null,
      source: 'SCHEDULED',
      delayMinutes: null,
      platform: null,
      ageMinutes: null,
      stale: false,
    }
  }
  return (
    map.get(
      trainCacheKey({
        trainNo: order.trainNo,
        serviceDate: order.serviceDate,
        stationCode: order.stationCode,
      }),
    ) ?? {
      effectiveArrival: order.scheduledArrival ?? null,
      source: 'SCHEDULED',
      delayMinutes: null,
      platform: null,
      ageMinutes: null,
      stale: false,
    }
  )
}
