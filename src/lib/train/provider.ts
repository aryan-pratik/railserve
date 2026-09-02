/**
 * Plan §8: every train-status source sits behind this interface.
 *
 * "Assume you will swap providers at least once; that must be a one-file
 * change." The one file is index.ts in this directory — nothing else in the
 * codebase imports a concrete provider.
 */
export type TrainStatusReading = {
  etaAt: Date | null
  delayMinutes: number | null
  platform: string | null
  /**
   * When the upstream itself last had news — not when we asked.
   *
   * These are different numbers, and only this one bounds how far the ETA can
   * be trusted: a train between stations reports nothing, so a reading fetched
   * a second ago can rest on a position forty minutes old. `fetchedAt` on the
   * cache row answers "is our copy current"; this answers "is theirs".
   * Providers whose payload does not carry it return null.
   */
  providerUpdatedAt: Date | null
}

/**
 * Everything a person needs to make sense of a train, as opposed to the three
 * fields the ordering flow computes with.
 *
 * Kept separate from TrainStatusReading on purpose: none of this is cached or
 * relied on for dispatch timing, and a provider that cannot supply it is still
 * a perfectly good provider. It exists for the admin lookup, where "CNB, 09:35,
 * on time" is not enough to act on — you need to know that is Kanpur Central,
 * that the train is called SWATANTRA S EXP, what time it was *supposed* to
 * arrive, and where the thing actually is right now.
 */
export type TrainDetail = {
  trainNo: string
  trainName: string | null
  stationCode: string
  stationName: string | null
  /** The timetable, so the live number has something to be compared against. */
  scheduledArrival: Date | null
  etaAt: Date | null
  delayMinutes: number | null
  platform: string | null
  /** Where the train has actually got to, and what that stop is called. */
  currentStationCode: string | null
  currentStationName: string | null
  /** The vendor's own summary line, e.g. "Arrived at HAJIPUR JN(HJP) …". */
  statusNote: string | null
  /** When the upstream itself last heard anything — not when we asked. */
  providerUpdatedAt: Date | null
  /** Stops still to go before it reaches us, when the route says. */
  stopsAway: number | null
  distanceKm: number | null
}

export interface TrainStatusProvider {
  /** Human-readable name, recorded on the cache row for debugging. */
  readonly name: string

  getStatus(
    trainNo: string,
    serviceDate: string,
    stationCode: string,
  ): Promise<TrainStatusReading>

  /**
   * Optional richer view for the admin lookup. Providers that only expose a
   * single station's timing simply omit it, and callers fall back to
   * getStatus — so adding a vendor never means implementing this first.
   */
  getDetail?(
    trainNo: string,
    serviceDate: string,
    stationCode: string,
  ): Promise<TrainDetail>
}

/** Thrown by a provider when the upstream is unreachable or unusable. */
export class TrainStatusUnavailable extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TrainStatusUnavailable'
  }
}
