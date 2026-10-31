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
  /**
   * True once the provider confirms the train has actually left this
   * station — not merely that our projected ETA has passed.
   *
   * Those are different claims. An ETA slipping into the past just means a
   * late train hasn't caught up to our last read yet, and stopping there
   * would silently give up on exactly the train most worth still checking.
   * "Arrived" means the feed itself says so — a `passed` halt with a real
   * departure time — after which the platform, delay and arrival at this
   * station are history and cannot change again, so nothing is gained by
   * asking again. Providers that cannot tell the difference return false and
   * polling continues exactly as before; nothing regresses for them.
   */
  arrived: boolean
  /**
   * The date this run left its origin, 'YYYY-MM-DD'. Not the service date: a
   * train reaching us on the 17th may have started on the 15th, and that is
   * the date a passenger's ticket and the railway's own enquiry go by.
   * Optional; providers that do not report it leave it out.
   */
  startDate?: string | null
  /**
   * The railway's own timetabled arrival at this station for the run read —
   * the timetable, not the projection. Used to correct a booking that put the
   * train on the wrong day (see rescheduledArrival). Optional; providers that
   * do not publish a timetable leave it out.
   */
  timetableAt?: Date | null
  /**
   * Which upstream actually answered, when a provider can ask more than one.
   * Recorded on the cache row in place of the provider's own name, so a
   * reading served by a fallback says so. Absent means the provider itself.
   */
  source?: string
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
  /** See TrainStatusReading.arrived — same meaning, same caution about it. */
  arrived: boolean
  /** See TrainStatusReading.startDate. */
  startDate?: string | null
  /** See TrainStatusReading.source. */
  source?: string
}

export interface TrainStatusProvider {
  /** Human-readable name, recorded on the cache row for debugging. */
  readonly name: string

  /**
   * `scheduledArrival` is the order's booked arrival, when there is one. The
   * service date alone can name the wrong run: a train booked in at 00:02 that
   * the timetable now brings in at 23:40 the evening before is the previous
   * day's departure, and a provider that can see the timetable uses this to
   * pick it. Providers that cannot simply ignore it.
   */
  getStatus(
    trainNo: string,
    serviceDate: string,
    stationCode: string,
    scheduledArrival?: Date | null,
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
    scheduledArrival?: Date | null,
  ): Promise<TrainDetail>
}

/** Thrown by a provider when the upstream is unreachable or unusable. */
export class TrainStatusUnavailable extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TrainStatusUnavailable'
  }
}
