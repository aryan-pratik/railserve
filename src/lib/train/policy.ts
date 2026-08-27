/**
 * Polling cadence and dispatch timing. Pure functions — no clock of their own,
 * no database — so both the worker and the tests drive them the same way.
 */

/** Plan §8 polling policy, expressed as minutes between refreshes. */
export function pollIntervalMinutes(minutesToArrival: number | null): number {
  // No scheduled time to reason about: poll at the slowest cadence rather than
  // hammering a paid API for a train we cannot place.
  if (minutesToArrival === null) return 10
  if (minutesToArrival > 60) return 10
  if (minutesToArrival >= 30) return 5
  return 2
}

/** True when a cached reading has aged past its tier. */
export function isStale(
  fetchedAt: Date | null,
  minutesToArrival: number | null,
  now: Date,
): boolean {
  if (!fetchedAt) return true
  const ageMinutes = (now.getTime() - fetchedAt.getTime()) / 60_000
  return ageMinutes >= pollIntervalMinutes(minutesToArrival)
}

export function minutesBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 60_000)
}

/**
 * Plan §9: dispatchAt = etaAt - walkToPlatformMinutes - bufferMinutes.
 *
 * Returns null when there is no ETA to work back from; the caller shows a
 * scheduled time instead rather than inventing one.
 */
export function computeDispatchAt(params: {
  etaAt: Date | null
  walkToPlatformMinutes: number
  bufferMinutes: number
}): Date | null {
  const { etaAt, walkToPlatformMinutes, bufferMinutes } = params
  if (!etaAt) return null
  return new Date(etaAt.getTime() - (walkToPlatformMinutes + bufferMinutes) * 60_000)
}

export type TimingView = {
  /** The time the run is actually expected, live if we have it. */
  effectiveArrival: Date | null
  source: 'LIVE' | 'SCHEDULED'
  delayMinutes: number | null
  platform: string | null
  /** Age of the live reading in minutes; null when there is no reading. */
  ageMinutes: number | null
  /** True when the reading exists but has aged past its tier. */
  stale: boolean
}

/**
 * Merges a scheduled time with whatever live reading we hold.
 *
 * Plan §8: "On provider failure, keep the last known value, mark it stale, and
 * show the age in the UI. Never present a stale ETA as live." So a stale
 * reading still returns its numbers — an agent is better off knowing the train
 * was 40 minutes late as of 12 minutes ago than knowing nothing — but it is
 * flagged, and the UI is expected to say so.
 */
export function buildTimingView(params: {
  scheduledArrival: Date | null
  reading: { etaAt: Date | null; delayMinutes: number | null; platform: string | null; fetchedAt: Date } | null
  now: Date
}): TimingView {
  const { scheduledArrival, reading, now } = params

  if (!reading) {
    return {
      effectiveArrival: scheduledArrival,
      source: 'SCHEDULED',
      delayMinutes: null,
      platform: null,
      ageMinutes: null,
      stale: false,
    }
  }

  const effectiveArrival = reading.etaAt ?? scheduledArrival
  const minutesToArrival = effectiveArrival ? minutesBetween(now, effectiveArrival) : null
  const ageMinutes = Math.max(0, Math.floor((now.getTime() - reading.fetchedAt.getTime()) / 60_000))

  return {
    effectiveArrival,
    // A reading with no usable ETA is not live timing, whatever else it carried.
    source: reading.etaAt ? 'LIVE' : 'SCHEDULED',
    delayMinutes: reading.delayMinutes,
    platform: reading.platform,
    ageMinutes,
    stale: isStale(reading.fetchedAt, minutesToArrival, now),
  }
}

/**
 * Plan §9 delay guard. Returns true when Generate KOT should ask for
 * confirmation rather than printing straight away.
 *
 * An unknown delay is NOT a warning: if the feed is down we have no grounds to
 * second-guess the kitchen, and a dialog that fires on missing data teaches
 * people to click through dialogs.
 */
export function shouldWarnAboutDelay(
  delayMinutes: number | null,
  thresholdMinutes: number,
): boolean {
  if (delayMinutes === null) return false
  return delayMinutes >= thresholdMinutes
}
