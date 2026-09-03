/**
 * Polling cadence and dispatch timing. Pure functions — no clock of their own,
 * no database — so both the worker and the tests drive them the same way.
 */

/**
 * Minutes between refreshes for one train, by how far off its arrival is.
 *
 * Correct data at the moment someone acts on it matters more than the cost of
 * asking for it — the `arrived` flag (see isStale) is what actually bounds
 * spend, by cutting a train off the moment it is confirmed done, so the tight
 * bands below only ever apply for a train's last 15-ish minutes of relevance,
 * not indefinitely. That is what makes tightening here safe rather than a
 * cost trade-off: nothing here is optimizing calls away from correctness.
 *
 * The bands widen far out (nothing is decided two hours before a train, and
 * the vendor's own projection that far ahead assumes recovery anyway) and
 * tighten hard in the stretch that actually matters: 5-15 minutes out is
 * where a rider is typically told to leave (walk + buffer), and the last 5
 * minutes is where a platform change or a last-second delay update is worth
 * the most.
 *
 * These intervals are read against a fixed tick (the cron runs every two
 * minutes); the tick makes no upstream call unless one of these has elapsed.
 */
export function pollIntervalMinutes(minutesToArrival: number | null): number {
  // No scheduled time to reason about: poll at the slowest cadence rather than
  // hammering a paid API for a train we cannot place.
  if (minutesToArrival === null) return 40
  if (minutesToArrival > 180) return 60
  if (minutesToArrival > 120) return 40
  if (minutesToArrival > 60) return 15
  if (minutesToArrival > 30) return 10
  if (minutesToArrival > 15) return 5
  if (minutesToArrival > 5) return 2
  if (minutesToArrival >= 0) return 1
  // Past due and not yet confirmed arrived: still worth checking briskly —
  // this is a late train, exactly the one most likely to still be moving.
  return 2
}

/**
 * How soon to retry after a failed fetch, regardless of the tier above.
 *
 * Without this, a transient failure during the tightest band — the one that
 * exists specifically so a delay update lands before dispatch — could leave a
 * row silent for up to its own tier, because a failed fetch still stamps
 * `fetchedAt`. A gap here is the one moment "efficient" and "correct" would
 * actually conflict, so it does not: retrying every few minutes on an error
 * costs a handful of extra calls only while something is actually wrong.
 */
const RETRY_AFTER_ERROR_MINUTES = 3

/**
 * True when a cached reading has aged past its tier.
 *
 * A row already confirmed `arrived` is never stale, whatever its age: the
 * train left this station, so its arrival/platform/delay here are final and
 * every further call would spend quota to learn something that cannot have
 * changed. This is the one thing that overrides the tier outright, rather
 * than widening it — a train that has arrived is not "due in 40 minutes"
 * again next service date, it is simply done.
 */
export function isStale(
  fetchedAt: Date | null,
  minutesToArrival: number | null,
  now: Date,
  arrived = false,
  hasError = false,
): boolean {
  if (arrived) return false
  if (!fetchedAt) return true
  const ageMinutes = (now.getTime() - fetchedAt.getTime()) / 60_000
  const tier = hasError
    ? Math.min(pollIntervalMinutes(minutesToArrival), RETRY_AFTER_ERROR_MINUTES)
    : pollIntervalMinutes(minutesToArrival)
  return ageMinutes >= tier
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
  /**
   * The time the ORDER was booked against, kept alongside the live one.
   *
   * Shown rather than replaced, because "09:10" on its own says nothing about
   * whether that is the time the kitchen planned around. Seeing both is also
   * the only way to notice when an aggregator's stated arrival disagrees with
   * the railway's — on this route two of them are out by about two hours, and
   * with a single number on screen nobody would ever find that.
   */
  scheduledArrival: Date | null
  source: 'LIVE' | 'SCHEDULED'
  delayMinutes: number | null
  platform: string | null
  /** Age of the live reading in minutes; null when there is no reading. */
  ageMinutes: number | null
  /** True when the reading exists but has aged past its tier. */
  stale: boolean
  /**
   * When the railway's own feed last had news, if it publishes that.
   *
   * `ageMinutes` is how long since WE asked; this is how long since THEY knew.
   * A train between stations reports nothing, so the two diverge exactly when
   * it matters — and the second is the one that bounds the ETA.
   */
  providerUpdatedAt: Date | null
  /**
   * When WE last asked the provider, and the earliest we will ask again.
   *
   * The board refreshes itself every 30 seconds but the data behind it does
   * not — a train on the 40-minute tier is skipped 19 renders out of 20, by
   * design. Without these two the screen looks equally live either way, so a
   * time that has not moved in half an hour is indistinguishable from one
   * confirmed a moment ago, and there is no way to tell a working system from
   * a stuck one except by watching a number that may not be due to change.
   *
   * `nextCheckAt` is the earliest, not the exact moment: the cron ticks every
   * two minutes and any board render can also trigger the refresh, so the real
   * update lands shortly after.
   */
  checkedAt: Date | null
  nextCheckAt: Date | null
  /**
   * True once the provider has confirmed this train left the station — see
   * TrainStatusReading.arrived. `nextCheckAt` is null exactly when this is
   * true: there is no next check, so the UI should say so plainly rather than
   * show a countdown that will never arrive.
   */
  arrived: boolean
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
  reading: {
    etaAt: Date | null
    delayMinutes: number | null
    platform: string | null
    fetchedAt: Date
    providerUpdatedAt?: Date | null
    arrived?: boolean
  } | null
  now: Date
}): TimingView {
  const { scheduledArrival, reading, now } = params

  if (!reading) {
    return {
      effectiveArrival: scheduledArrival,
      scheduledArrival,
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

  const arrived = reading.arrived ?? false
  const effectiveArrival = reading.etaAt ?? scheduledArrival
  const minutesToArrival = effectiveArrival ? minutesBetween(now, effectiveArrival) : null
  const ageMinutes = Math.max(0, Math.floor((now.getTime() - reading.fetchedAt.getTime()) / 60_000))

  return {
    effectiveArrival,
    scheduledArrival,
    // A reading with no usable ETA is not live timing, whatever else it carried.
    source: reading.etaAt ? 'LIVE' : 'SCHEDULED',
    delayMinutes: reading.delayMinutes,
    platform: reading.platform,
    ageMinutes,
    stale: isStale(reading.fetchedAt, minutesToArrival, now, arrived),
    providerUpdatedAt: reading.providerUpdatedAt ?? null,
    checkedAt: reading.fetchedAt,
    // Same tier isStale() is about to apply, so the UI and the poller cannot
    // disagree about when this row comes due — and once arrived, there is no
    // "due" left to compute: null here is what tells the UI to stop showing
    // a countdown and say the train has arrived instead.
    nextCheckAt: arrived
      ? null
      : new Date(reading.fetchedAt.getTime() + pollIntervalMinutes(minutesToArrival) * 60_000),
    arrived,
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
