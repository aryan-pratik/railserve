import { TrainStatusUnavailable, type TrainStatusProvider, type TrainStatusReading } from './provider'

/**
 * RapidAPI-backed provider. Activates when TRAIN_API_KEY is set.
 *
 * Response shapes differ between the RapidAPI train providers (IndianRail,
 * ConfirmTkt, RailYatri) and none of them are stable, so parsing is defensive
 * and deliberately narrow: pull the station's row out of whatever array the
 * body exposes, and treat anything unrecognised as unavailable rather than
 * guessing. A wrong ETA is worse than a missing one — it moves the leave-now
 * alert to the wrong minute.
 */
type UnknownRecord = Record<string, unknown>

function pickArray(body: UnknownRecord): UnknownRecord[] {
  for (const key of ['route', 'stations', 'data', 'body', 'TrainRoute']) {
    const v = body[key]
    if (Array.isArray(v)) return v as UnknownRecord[]
  }
  return []
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const m = /-?\d+/.exec(v)
    if (m) return Number(m[0])
  }
  return null
}

export class RapidApiTrainStatusProvider implements TrainStatusProvider {
  readonly name = 'rapidapi'

  constructor(
    private readonly apiKey: string,
    private readonly apiHost: string,
  ) {}

  async getStatus(
    trainNo: string,
    serviceDate: string,
    stationCode: string,
  ): Promise<TrainStatusReading> {
    const url = `https://${this.apiHost}/api/v1/liveTrainStatus?trainNo=${encodeURIComponent(
      trainNo,
    )}&startDay=0`

    let res: Response
    try {
      res = await fetch(url, {
        headers: {
          'x-rapidapi-key': this.apiKey,
          'x-rapidapi-host': this.apiHost,
        },
        // Plan §13.6: train API downtime must never block order flow.
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
      })
    } catch (err) {
      throw new TrainStatusUnavailable(
        `train API unreachable: ${err instanceof Error ? err.message : 'unknown'}`,
      )
    }

    if (!res.ok) {
      throw new TrainStatusUnavailable(`train API returned ${res.status}`)
    }

    let body: UnknownRecord
    try {
      body = (await res.json()) as UnknownRecord
    } catch {
      throw new TrainStatusUnavailable('train API returned a non-JSON body')
    }

    const rows = pickArray(body)
    const row = rows.find((r) => {
      const code = str(r.stationCode) ?? str(r.station_code) ?? str(r.StationCode)
      return code?.toUpperCase() === stationCode.toUpperCase()
    })

    if (!row) {
      throw new TrainStatusUnavailable(`train API response has no row for ${stationCode}`)
    }

    const delayMinutes =
      num(row.delay) ?? num(row.delayArrival) ?? num(row.arrivalDelay) ?? null
    const platform = str(row.platform) ?? str(row.platformNumber) ?? null

    const etaRaw =
      str(row.eta) ?? str(row.expectedArrival) ?? str(row.actualArrivalTime) ?? null
    let etaAt: Date | null = null
    if (etaRaw) {
      // Providers return either an ISO instant or a bare HH:mm in IST.
      const asDate = /^\d{4}-/.test(etaRaw)
        ? new Date(etaRaw)
        : new Date(`${serviceDate}T${etaRaw.padStart(5, '0')}:00+05:30`)
      if (!Number.isNaN(asDate.getTime())) etaAt = asDate
    }

    return { etaAt, delayMinutes, platform }
  }
}
