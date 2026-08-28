import { TrainStatusUnavailable, type TrainStatusProvider, type TrainStatusReading } from './provider'

/**
 * Adapter for indian-railway-irctc.p.rapidapi.com ("IRCTC1" on RapidAPI).
 *
 * Verified against a REAL response for train 12506 — this maps actual field
 * names, not guessed ones. Kept narrow to this one provider on purpose: plan
 * §8 calls the RapidAPI shapes unstable, so a defensive parser that tried to
 * cover several vendors' guessed shapes was worse than one that maps a known
 * shape precisely and fails closed on anything else.
 *
 * The endpoint returns the FULL route for the run in one call. Every station
 * carries both a scheduled time and an `actual_arrival_time` — and for
 * stations still ahead of the train, that field is IRCTC's own forward
 * projection at the train's current running delay, not just a historical
 * record. That's exactly the ETA this system needs; there is no separate
 * "delay" field to read, so it is computed from the two times.
 */
type IrctcStation = {
  stationCode?: string
  arrivalTime?: string // scheduled, 'HH:mm'
  dayCount?: string // '1', '2', ... which day of a multi-day run this station falls on
  actual_arrival_date?: string // 'YYYYMMDD', live/projected
  actual_arrival_time?: string // 'HH:mm', live/projected
  expected_platform?: number | string | null
}

type IrctcResponse = {
  error?: unknown
  status?: { result?: string }
  body?: { stations?: IrctcStation[] }
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
    const departureDate = serviceDate.replace(/-/g, '') // 'YYYY-MM-DD' -> 'YYYYMMDD'

    const url =
      `https://${this.apiHost}/api/trains/v1/train/status` +
      `?departure_date=${departureDate}&isH5=true&client=web` +
      `&deviceIdentifier=railserve&train_number=${encodeURIComponent(trainNo)}`

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
      // These three are configuration or billing problems, not transient
      // outages, and they will not fix themselves. Saying so precisely is the
      // difference between a banner someone can act on and a silent fallback
      // to scheduled times that looks like the train simply has no live data.
      if (res.status === 429) {
        throw new TrainStatusUnavailable(
          'train API quota exhausted — the RapidAPI plan is out of requests for this period',
        )
      }
      if (res.status === 401 || res.status === 403) {
        throw new TrainStatusUnavailable(
          'train API rejected the key — check TRAIN_API_KEY and that the plan covers this host',
        )
      }
      throw new TrainStatusUnavailable(`train API returned ${res.status}`)
    }

    let body: IrctcResponse
    try {
      body = (await res.json()) as IrctcResponse
    } catch {
      throw new TrainStatusUnavailable('train API returned a non-JSON body')
    }

    if (body.error || body.status?.result !== 'success') {
      throw new TrainStatusUnavailable(
        typeof body.error === 'string' ? body.error : 'train API reported an error',
      )
    }

    const row = (body.body?.stations ?? []).find(
      (s) => s.stationCode?.toUpperCase() === stationCode.toUpperCase(),
    )
    if (!row) {
      throw new TrainStatusUnavailable(`no row for station ${stationCode} in the returned route`)
    }

    return {
      etaAt: combineIstDateTime(row.actual_arrival_date, row.actual_arrival_time),
      delayMinutes: computeDelayMinutes(serviceDate, row),
      platform:
        row.expected_platform !== undefined && row.expected_platform !== null
          ? String(row.expected_platform)
          : null,
    }
  }
}

/** 'YYYYMMDD' + 'HH:mm', read as IST wall time. */
function combineIstDateTime(dateYYYYMMDD?: string, timeHHmm?: string): Date | null {
  if (!dateYYYYMMDD || !timeHHmm || !/^\d{8}$/.test(dateYYYYMMDD)) return null
  const y = dateYYYYMMDD.slice(0, 4)
  const m = dateYYYYMMDD.slice(4, 6)
  const d = dateYYYYMMDD.slice(6, 8)
  const dt = new Date(`${y}-${m}-${d}T${timeHHmm}:00+05:30`)
  return Number.isNaN(dt.getTime()) ? null : dt
}

/**
 * Delay = actual arrival minus scheduled arrival, both anchored to the
 * station's own day of the run (`dayCount`) rather than the service date on
 * its own — a multi-day train's later stations fall on a later calendar date
 * than departure, and comparing raw HH:mm strings across that boundary would
 * be wrong by exactly one day.
 */
function computeDelayMinutes(serviceDate: string, row: IrctcStation): number | null {
  if (!row.arrivalTime || !row.actual_arrival_date || !row.actual_arrival_time) return null

  const dayOffset = row.dayCount ? Math.max(0, Number(row.dayCount) - 1) : 0
  const scheduledDay = new Date(`${serviceDate}T00:00:00+05:30`)
  scheduledDay.setUTCDate(scheduledDay.getUTCDate() + dayOffset)
  const scheduledDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' })
    .format(scheduledDay)
    .replace(/-/g, '')

  const scheduledAt = combineIstDateTime(scheduledDateStr, row.arrivalTime)
  const actualAt = combineIstDateTime(row.actual_arrival_date, row.actual_arrival_time)
  if (!scheduledAt || !actualAt) return null

  return Math.round((actualAt.getTime() - scheduledAt.getTime()) / 60_000)
}
