import { connectDb } from '../db'
import { TrainStatus, type TrainStatusDoc } from '../models'
import { getTrainStatusProvider } from './index'
import { TrainStatusUnavailable, type TrainDetail } from './provider'
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

    // A reading that carries no arrival time is the feed having nothing to
    // say, not the train having no arrival time — and the two must not be
    // written the same way.
    //
    // RailKit sometimes publishes no time for a stop at all: 12561 sat at
    // "actual": "--" for Kanpur while the halt before it (Prayagraj) reported
    // 1h26m down and the halt after it (Aligarh) carried a projection. Only
    // the one stop we care about was missing. Copying that over a good ETA
    // replaced 10:36 with nothing, and the board fell back to a booked time —
    // which is worse than saying nothing, because it still looks like an
    // answer.
    //
    // So an empty reading keeps what we already knew, exactly as a failed
    // fetch does. lastSuccessAt deliberately does not move: it means the last
    // time we actually learned something, and the age shown to a person
    // should not reset because we asked and were told nothing.
    const learnedSomething = reading.etaAt !== null || reading.delayMinutes !== null
    const live = learnedSomething
      ? { etaAt: reading.etaAt, delayMinutes: reading.delayMinutes }
      : {}
    // Platform is independent: it survives after arrival and is worth keeping
    // whenever it is offered, but never blanked by an omission.
    const platform = reading.platform !== null ? { platform: reading.platform } : {}
    // Always written, including when it is null. This is how old the upstream's
    // own information is, and holding a previous run's value here would
    // overstate how far the ETA above can be trusted.
    const upstream = { providerUpdatedAt: reading.providerUpdatedAt }

    const doc = await TrainStatus.findOneAndUpdate(
      filter,
      {
        $set: {
          ...live,
          ...platform,
          ...upstream,
          fetchedAt: now,
          ...(learnedSomething ? { lastSuccessAt: now } : {}),
          lastError: null,
          provider: provider.name,
        },
        // $max rather than $set: false BSON-compares below true, so this can
        // only ever flip a row from not-arrived to arrived, never back. A
        // provider hiccup reporting arrived:false the moment after a genuine
        // arrival must not put the train back into rotation.
        $max: { arrived: reading.arrived },
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

/**
 * A full picture of one train at one station, for a person rather than for the
 * dispatch maths — see TrainDetail.
 *
 * Costs the same single upstream call as a refresh and writes the same cache
 * row, so an admin looking a train up also warms it for every order riding it.
 * Providers that cannot describe themselves fall back to the plain reading,
 * with the descriptive fields left null rather than invented.
 */
export async function lookupTrainDetail(key: TrainKey): Promise<TrainDetail> {
  await connectDb()

  const provider = getTrainStatusProvider(() => null)
  const stationCode = key.stationCode.toUpperCase()
  const filter = { trainNo: key.trainNo, serviceDate: key.serviceDate, stationCode }
  const now = new Date()

  const detail: TrainDetail = provider.getDetail
    ? await provider.getDetail(key.trainNo, key.serviceDate, stationCode)
    : {
        ...(await provider.getStatus(key.trainNo, key.serviceDate, stationCode)),
        trainNo: key.trainNo,
        trainName: null,
        stationCode,
        stationName: null,
        scheduledArrival: null,
        currentStationCode: null,
        currentStationName: null,
        statusNote: null,
        stopsAway: null,
        distanceKm: null,
        // providerUpdatedAt is NOT overridden here: it comes from the reading
        // spread above, which every provider now supplies.
      }

  await TrainStatus.findOneAndUpdate(
    filter,
    {
      $set: {
        etaAt: detail.etaAt,
        delayMinutes: detail.delayMinutes,
        platform: detail.platform,
        providerUpdatedAt: detail.providerUpdatedAt,
        fetchedAt: now,
        lastSuccessAt: now,
        lastError: null,
        provider: provider.name,
      },
      // Same one-way $max as refreshTrainStatus — an admin's manual lookup
      // should stop the automatic tick from polling this train too, not just
      // report the answer once.
      $max: { arrived: detail.arrived },
    },
    { upsert: true },
  )

  return detail
}

/**
 * Warms the cache for a train the moment an order for it appears.
 *
 * Without this, a new order waits for the next tick before anyone knows where
 * its train is — up to a couple of minutes of showing a scheduled time for a
 * train that may already be an hour down. The order screen is looked at
 * straight away, so the first look should be the true one.
 *
 * Cache-first on purpose: four orders arriving on the same train cost one
 * call, not four. And it never throws — a train feed being down is not a
 * reason to fail an order that is otherwise perfectly good (plan §13.6), and
 * the polling tick will pick the train up regardless.
 */
export async function warmTrainStatus(order: {
  trainNo?: string | null
  serviceDate: string
  stationCode: string
  scheduledArrival?: Date | null
}): Promise<void> {
  if (!order.trainNo) return
  try {
    await getTrainStatus(
      {
        trainNo: order.trainNo,
        serviceDate: order.serviceDate,
        stationCode: order.stationCode,
      },
      { scheduledArrival: order.scheduledArrival ?? null },
    )
  } catch {
    // Deliberately silent: refreshTrainStatus already records the failure on
    // the cache row, and the caller is in the middle of accepting an order.
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

  if (cachedRow && !isStale(cachedRow.fetchedAt, minutesToArrival, now, cachedRow.arrived)) {
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
                providerUpdatedAt: row.providerUpdatedAt ?? null,
                arrived: row.arrived ?? false,
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
      scheduledArrival: order.scheduledArrival ?? null,
      source: 'SCHEDULED',
      delayMinutes: null,
      platform: null,
      ageMinutes: null,
      stale: false,
      providerUpdatedAt: null,
      checkedAt: null,
      nextCheckAt: null,
      arrived: false,
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
      scheduledArrival: order.scheduledArrival ?? null,
      source: 'SCHEDULED',
      delayMinutes: null,
      platform: null,
      ageMinutes: null,
      stale: false,
      providerUpdatedAt: null,
      checkedAt: null,
      nextCheckAt: null,
      arrived: false,
    }
  )
}

export type TrainFeedHealth = {
  /** True when the latest attempt for at least one train failed. */
  failing: boolean
  /** The provider's own message from the most recent failure. */
  message: string | null
  /** Last time a fetch actually succeeded on the train that is failing. */
  lastSuccessAt: Date | null
  /** Train numbers whose latest attempt failed, newest failure first. */
  failingTrains: string[]
  /** How many trains were attempted in the window at all. */
  trainsTried: number
}

/**
 * Is the live feed working right now?
 *
 * refreshTrainStatus already keeps the last good reading and records why the
 * newest attempt failed — the degradation contract from plan §8. But the UI
 * only ever saw the reading, so an expired API key, a spent quota and a train
 * that genuinely has no live data all rendered identically as a scheduled
 * time. This is the missing half: the reason, so it can be said out loud.
 *
 * Judged per train rather than on the newest attempt overall, which was wrong
 * in both directions. It overstated — one train with no data on an otherwise
 * healthy feed read as "the feed is down" — and, worse, it under-reported: the
 * verdict came from whichever row was fetched last, so a single success after
 * a failure hid the failure completely, and the train with no live status sat
 * on a timetable time with nothing anywhere saying so. Each cache row already
 * IS the latest attempt for its train, so counting them is the whole fix.
 */
export async function trainFeedHealth(withinMinutes = 120): Promise<TrainFeedHealth> {
  await connectDb()

  const rows = await TrainStatus.find({
    fetchedAt: { $gte: new Date(Date.now() - withinMinutes * 60_000) },
  })
    .sort({ fetchedAt: -1 })
    .select('trainNo lastError lastSuccessAt')
    .lean()

  // No attempt in the window is not a failure — it means nothing needed
  // polling, which is the normal state of a quiet morning.
  const failed = rows.filter((r) => r.lastError)
  if (!failed.length) {
    return {
      failing: false,
      message: null,
      lastSuccessAt: null,
      failingTrains: [],
      trainsTried: rows.length,
    }
  }

  return {
    failing: true,
    message: failed[0].lastError ?? null,
    lastSuccessAt: failed[0].lastSuccessAt ?? null,
    failingTrains: [...new Set(failed.map((r) => r.trainNo))],
    trainsTried: rows.length,
  }
}
