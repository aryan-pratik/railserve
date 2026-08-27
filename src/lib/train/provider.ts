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
}

export interface TrainStatusProvider {
  /** Human-readable name, recorded on the cache row for debugging. */
  readonly name: string

  getStatus(
    trainNo: string,
    serviceDate: string,
    stationCode: string,
  ): Promise<TrainStatusReading>
}

/** Thrown by a provider when the upstream is unreachable or unusable. */
export class TrainStatusUnavailable extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TrainStatusUnavailable'
  }
}
