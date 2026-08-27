import type { TrainStatusProvider, TrainStatusReading } from './provider'

/**
 * Offline provider used when no TRAIN_API_KEY is configured.
 *
 * Deterministic, not random: the same train on the same day always reports the
 * same delay, so a demo is reproducible and a test can assert on it. Delay is
 * derived from a hash of the train number and date, which spreads trains across
 * the range without anyone having to curate fixtures.
 *
 * This exists so the delay guard, the dispatch maths and the stale indicator
 * are all exercisable without a third-party account. It is not a forecast of
 * anything.
 */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

export class SimulatedTrainStatusProvider implements TrainStatusProvider {
  readonly name = 'simulator'

  constructor(private readonly scheduledArrivalFor?: (trainNo: string) => Date | null) {}

  async getStatus(
    trainNo: string,
    serviceDate: string,
    stationCode: string,
  ): Promise<TrainStatusReading> {
    const seed = hash(`${trainNo}:${serviceDate}:${stationCode}`)

    // Roughly: half the trains near-punctual, a third mildly late, the rest
    // badly late — which is the shape that makes the 45-minute KOT guard
    // actually fire sometimes.
    const bucket = seed % 100
    const delayMinutes =
      bucket < 45 ? seed % 8
      : bucket < 78 ? 15 + (seed % 25)
      : 50 + (seed % 90)

    const platform = String((seed % 8) + 1)

    const scheduled = this.scheduledArrivalFor?.(trainNo) ?? null
    const etaAt = scheduled ? new Date(scheduled.getTime() + delayMinutes * 60_000) : null

    return { etaAt, delayMinutes, platform }
  }
}
