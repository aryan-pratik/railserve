import {
  TrainStatusUnavailable,
  type TrainDetail,
  type TrainStatusProvider,
  type TrainStatusReading,
} from './provider'

type DetailedProvider = TrainStatusProvider & {
  getDetail: NonNullable<TrainStatusProvider['getDetail']>
}

/**
 * Asks one provider, and a second only where the first had nothing to say.
 *
 * Built for RailKit v2 (WIMT) in front of v1 (NTES). Against the same trains
 * v2 updated minutes sooner and kept a time where v1 went blank — 22466 read
 * "--" on v1 at 1.5 km out of Kanpur while v2 had 17:55 — but v2 has gaps of
 * its own: 12561 at CNB came back with no actual at all, and 42 of 318 halts
 * carried no platform. So the secondary fills exactly those holes:
 *
 * - primary throws, or answers with no ETA      -> the secondary's reading
 * - primary has an ETA but no platform           -> the secondary's platform only
 * - both empty or failing                        -> empty, or one error naming both
 *
 * The ETA is checked BEFORE `arrived` is believed: v2 marked 12561's CNB halt
 * departed with no time on it, and passing that through would stop polling a
 * train whose arrival we never learned.
 */
export class FallbackTrainStatusProvider implements TrainStatusProvider {
  readonly name: string

  constructor(
    private readonly primary: DetailedProvider,
    private readonly secondary: DetailedProvider,
  ) {
    this.name = `${primary.name}>${secondary.name}`
  }

  async getStatus(
    trainNo: string,
    serviceDate: string,
    stationCode: string,
    scheduledArrival?: Date | null,
  ): Promise<TrainStatusReading> {
    return this.ask(
      `${trainNo}@${stationCode} ${serviceDate}`,
      (p) => p.getStatus(trainNo, serviceDate, stationCode, scheduledArrival),
      () => this.secondary.getStatus(trainNo, serviceDate, stationCode, scheduledArrival),
    )
  }

  async getDetail(
    trainNo: string,
    serviceDate: string,
    stationCode: string,
    scheduledArrival?: Date | null,
  ): Promise<TrainDetail> {
    return this.ask(
      `${trainNo}@${stationCode} ${serviceDate}`,
      (p) => p.getDetail(trainNo, serviceDate, stationCode, scheduledArrival),
      () => this.secondary.getStatus(trainNo, serviceDate, stationCode, scheduledArrival),
    )
  }

  private async ask<T extends TrainStatusReading>(
    label: string,
    fetch: (p: DetailedProvider) => Promise<T>,
    platformFrom: () => Promise<TrainStatusReading>,
  ): Promise<T> {
    let empty: T | null = null
    let primaryError: unknown = null
    // One line per reading the secondary had to serve, so `docker logs` can
    // count how often the primary falls short and why.
    const note = (reason: string) =>
      console.info(`[train-fallback] ${this.secondary.name} served ${reason} for ${label}`)

    try {
      const r = await fetch(this.primary)
      if (r.etaAt !== null) {
        // Once the train has left, its platform here is history and not worth a call.
        if (r.platform !== null || r.arrived) return r
        try {
          const platform = (await platformFrom()).platform
          if (platform === null) return r
          note('platform only')
          return { ...r, platform }
        } catch {
          // A platform is a nice-to-have; the primary's times stand without it.
          return r
        }
      }
      empty = r
    } catch (err) {
      primaryError = err
    }

    let secondaryError: unknown
    try {
      const f = await fetch(this.secondary)
      if (f.etaAt !== null || f.delayMinutes !== null || !empty) {
        note(empty ? 'the reading (primary had no time)' : `the reading (primary failed: ${describe(primaryError)})`)
        return f
      }
      // Neither had a time. Hand back an empty reading, which the cache treats
      // as "keep what we knew", with any platform either side offered.
      return { ...empty, platform: empty.platform ?? f.platform, arrived: false }
    } catch (err) {
      secondaryError = err
    }

    if (empty) return { ...empty, arrived: false }
    throw new TrainStatusUnavailable(
      `${this.primary.name}: ${describe(primaryError)}; ${this.secondary.name}: ${describe(secondaryError)}`,
    )
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : 'failed'
}
