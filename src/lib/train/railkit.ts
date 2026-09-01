import { configure, trackTrain } from 'railkit'
import {
  TrainStatusUnavailable,
  type TrainDetail,
  type TrainStatusProvider,
  type TrainStatusReading,
} from './provider'

/**
 * Adapter for RailKit (api.railkit.in), via its npm SDK.
 *
 * Verified against REAL responses for train 12561 on 01-09-2026 and
 * 02-09-2026 — every field name below was read off the wire, not guessed.
 *
 * The SDK is not optional. RailKit's documented REST endpoint
 * (`GET /api/trackTrain/:train/:date` with `x-api-key`) answers
 * 403 "Missing SDK signature headers" on the Pro plan; only the package
 * produces the signature it wants. So this is the one provider that reaches
 * upstream through a dependency rather than `fetch`, and the timeout below is
 * ours, wrapped around a call we cannot configure.
 *
 * Three things about the payload matter enough to state:
 *
 * 1. `timeline` includes every station the train passes, most of which it does
 *    not stop at (`type: "intermediate"`, no times at all). Only `"stoppage"`
 *    entries carry arrival/departure/platform.
 *
 * 2. Station codes must match exactly. Kanpur Central is CNB and Chandari is
 *    CNBI, both on this route — a substring match silently reads the wrong
 *    station, and CNBI is an intermediate with no times, so the failure would
 *    look like missing data rather than wrong data.
 *
 * 3. RailKit projects delay with recovery built in: a train 80 minutes down at
 *    its current stop shows 01:14 Hr at the next halt, 22 Min a few stops on,
 *    and "On Time" at a station nine hours ahead. That is IRCTC's own
 *    expected-recovery model, and it converges on reality as the train nears.
 *    We therefore read the target station's own projection rather than
 *    applying the current running delay flat — but only trust it near arrival,
 *    which is exactly when the polling policy asks.
 */

type RailKitTimes = {
  scheduled?: string // "09:35 02-Sep" — note: no year
  actual?: string // same, with a trailing "*" when projected; "--" when unknown
  delay?: string // "On Time" | "22 Min" | "01:20 Hr" | ""
}

type RailKitStation = {
  type?: string // "stoppage" | "intermediate"
  status?: string // "passed" | "current" | "upcoming"
  stationCode?: string
  stationName?: string
  platform?: string
  distanceKm?: string // "794", or "" at the origin
  arrival?: RailKitTimes
  departure?: RailKitTimes
}

type RailKitResponse = {
  success?: boolean
  error?: string
  data?: {
    date?: string // "01-Sep-2026" — the only field carrying a year
    trainName?: string
    statusNote?: string
    lastUpdate?: string // "02-Sep-2026 00:11", or "" before the run starts
    currentStationCode?: string
    timeline?: RailKitStation[]
  }
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

export class RailKitTrainStatusProvider implements TrainStatusProvider {
  readonly name = 'railkit'

  /**
   * Days between the run's departure from origin and its arrival at the
   * station we care about, learned from the first response and reused after.
   *
   * RailKit keys a run by the date it LEFT ITS SOURCE, while an order's
   * serviceDate is the date the train reaches the platform we deliver on.
   * For 12561 those differ by a day: the run serving Kanpur at 09:35 on the
   * 2nd departed Jaynagar on the 1st, and asking for the 2nd returns a train
   * that has not moved yet ("Yet to start from its source"). Getting this
   * wrong reads tomorrow's train and reports it perfectly on time.
   *
   * The offset is a property of the timetable, not of the day, so it is worth
   * exactly one extra call per train per process.
   */
  private readonly dayOffset = new Map<string, number>()

  constructor(apiKey: string) {
    // configure() sets module-level state in the SDK rather than returning a
    // client, so there is nothing to hold; doing it here keeps the one call
    // next to the key rather than at import time.
    configure(apiKey)
  }

  async getStatus(
    trainNo: string,
    serviceDate: string,
    stationCode: string,
  ): Promise<TrainStatusReading> {
    const { body, row } = await this.resolve(trainNo, serviceDate, stationCode)
    if (!row) {
      throw new TrainStatusUnavailable(
        `train ${trainNo} does not stop at ${stationCode} on the returned route`,
      )
    }

    return {
      etaAt: parseDayTime(row.arrival?.actual ?? row.arrival?.scheduled, body.data?.date),
      delayMinutes: parseDelay(row.arrival?.delay),
      platform: normalisePlatform(row.platform),
    }
  }

  /** Fetches the right departure for this service date, learning the offset once. */
  private async resolve(
    trainNo: string,
    serviceDate: string,
    stationCode: string,
  ): Promise<{ body: RailKitResponse; row: RailKitStation | undefined }> {
    const known = this.dayOffset.get(trainNo)
    let { body, row } = await this.fetchFor(trainNo, serviceDate, stationCode, known ?? 0)

    // Any response tells us how many days after departure this train reaches
    // this station, because it carries both dates. Learn it once, then ask for
    // the right departure from then on.
    if (known === undefined && row) {
      const offset = dayOffsetOf(row.arrival?.scheduled, body.data?.date)
      if (offset !== null) {
        this.dayOffset.set(trainNo, offset)
        if (offset !== 0) {
          const retry = await this.fetchFor(trainNo, serviceDate, stationCode, offset)
          if (retry.row) {
            body = retry.body
            row = retry.row
          }
        }
      }
    }

    return { body, row }
  }

  /**
   * The same lookup, but keeping everything the payload already carried.
   *
   * One call, same cost as getStatus — the descriptive fields were being
   * parsed and thrown away.
   */
  async getDetail(
    trainNo: string,
    serviceDate: string,
    stationCode: string,
  ): Promise<TrainDetail> {
    const { body, row } = await this.resolve(trainNo, serviceDate, stationCode)
    if (!row) {
      throw new TrainStatusUnavailable(
        `train ${trainNo} does not stop at ${stationCode} on the returned route`,
      )
    }

    const timeline = body.data?.timeline ?? []
    const currentCode = body.data?.currentStationCode ?? null
    const current = currentCode
      ? timeline.find((s) => s.stationCode?.toUpperCase() === currentCode.toUpperCase())
      : undefined

    // Halts between where it is now and where we are waiting.
    //
    // Positions are found in the FULL timeline, not just the halts: the train
    // reports itself at whatever station it last passed, and that is often an
    // intermediate it does not stop at (Nayagaon, on this run). Looking only
    // at halts fails to place it and silently reports nothing. Only halts are
    // then counted, because "stops away" means stops.
    const at = (code: string | null | undefined) =>
      code
        ? timeline.findIndex((s) => s.stationCode?.toUpperCase() === code.toUpperCase())
        : -1
    const currentIdx = at(currentCode)
    const targetIdx = at(stationCode)
    const stopsAway =
      currentIdx >= 0 && targetIdx > currentIdx
        ? timeline.slice(currentIdx + 1, targetIdx + 1).filter((s) => s.type === 'stoppage').length
        : currentIdx >= 0 && targetIdx === currentIdx
          ? 0
          : null

    const distance = Number(row.distanceKm)

    return {
      trainNo,
      trainName: body.data?.trainName?.trim() || null,
      stationCode: stationCode.toUpperCase(),
      stationName: row.stationName?.trim() || null,
      scheduledArrival: parseDayTime(row.arrival?.scheduled, body.data?.date),
      etaAt: parseDayTime(row.arrival?.actual ?? row.arrival?.scheduled, body.data?.date),
      delayMinutes: parseDelay(row.arrival?.delay),
      platform: normalisePlatform(row.platform),
      currentStationCode: currentCode,
      currentStationName: current?.stationName?.trim() || null,
      statusNote: body.data?.statusNote?.trim() || null,
      providerUpdatedAt: parseLastUpdate(body.data?.lastUpdate),
      stopsAway,
      distanceKm: Number.isFinite(distance) && distance > 0 ? distance : null,
    }
  }

  /** One upstream call, for the departure `offsetDays` before the service date. */
  private async fetchFor(
    trainNo: string,
    serviceDate: string,
    stationCode: string,
    offsetDays: number,
  ): Promise<{ body: RailKitResponse; row: RailKitStation | undefined }> {
    const body = await this.call(trainNo, shiftIsoDate(serviceDate, -offsetDays))

    if (!body.success) {
      throw new TrainStatusUnavailable(
        typeof body.error === 'string' ? body.error : 'train API reported an error',
      )
    }

    const wanted = stationCode.toUpperCase()
    const row = (body.data?.timeline ?? []).find(
      // Exact code, and a halt: see note 2 above.
      (s) => s.type === 'stoppage' && s.stationCode?.toUpperCase() === wanted,
    )
    return { body, row }
  }

  private async call(trainNo: string, ddmmyyyy: string): Promise<RailKitResponse> {
    try {
      // Plan §13.6: train API downtime must never block order flow. The SDK
      // exposes no timeout of its own, so the race is the only bound we have.
      return (await Promise.race([
        trackTrain(trainNo, ddmmyyyy),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timed out after 8000ms')), 8000),
        ),
      ])) as RailKitResponse
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown'
      // The SDK throws rather than returning a status, so quota and auth
      // failures arrive as message text. Name them precisely anyway — a spent
      // plan and a broken key are things someone can act on, and a silent
      // fallback to scheduled times looks identical to a train with no data.
      if (/quota|rate ?limit|429/i.test(message)) {
        throw new TrainStatusUnavailable(
          'train API quota exhausted — the RailKit plan is out of requests for this period',
        )
      }
      if (/api key|unauthor|forbidden|401|403/i.test(message)) {
        throw new TrainStatusUnavailable(
          'train API rejected the key — check TRAIN_API_KEY and that the plan covers this endpoint',
        )
      }
      throw new TrainStatusUnavailable(`train API unreachable: ${message}`)
    }
  }
}

/**
 * "09:35 02-Sep" -> Date, read as IST wall time.
 *
 * The stop's year is never in the field; it comes from the run's own date
 * ("01-Sep-2026"), which is the only place a year appears. A run departing 31
 * December arrives in January, so a stop in an earlier month than departure
 * belongs to the NEXT year — without that, a new-year delivery is timed twelve
 * months in the past and every order on it reads as impossibly late.
 */
function parseDayTime(value: string | undefined, dataDate: string | undefined): Date | null {
  if (!value) return null
  const cleaned = value.replace(/\*/g, '').trim()
  if (!cleaned || cleaned === '--' || cleaned === 'SRC') return null

  const m = /^(\d{1,2}):(\d{2})\s+(\d{1,2})-([A-Za-z]{3})$/.exec(cleaned)
  if (!m) return null

  const month = MONTHS[m[4].toLowerCase()]
  if (month === undefined) return null

  const dep = dataDate ? /(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(dataDate) : null
  const depMonth = dep ? MONTHS[dep[2].toLowerCase()] : undefined
  let year = dep ? Number(dep[3]) : new Date().getUTCFullYear()
  if (depMonth !== undefined && month < depMonth) year += 1

  const dt = new Date(
    `${year}-${String(month + 1).padStart(2, '0')}-${m[3].padStart(2, '0')}` +
      `T${m[1].padStart(2, '0')}:${m[2]}:00+05:30`,
  )
  return Number.isNaN(dt.getTime()) ? null : dt
}

/**
 * "02-Sep-2026 00:11" -> Date, read as IST wall time.
 *
 * This is when the upstream itself last had news, which is not the same as
 * when we asked — a feed that has not updated in an hour is worth knowing
 * about even if our own fetch was a second ago.
 */
function parseLastUpdate(value: string | undefined): Date | null {
  if (!value) return null
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!m) return null
  const month = MONTHS[m[2].toLowerCase()]
  if (month === undefined) return null

  const dt = new Date(
    `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}` +
      `T${m[4].padStart(2, '0')}:${m[5]}:00+05:30`,
  )
  return Number.isNaN(dt.getTime()) ? null : dt
}

/** Days between a stop's date and the run's departure date, or null if unreadable. */
function dayOffsetOf(scheduled: string | undefined, dataDate: string | undefined): number | null {
  if (!scheduled || !dataDate) return null
  const stop = /(\d{1,2})-([A-Za-z]{3})/.exec(scheduled.replace(/\*/g, ''))
  const dep = /(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(dataDate)
  if (!stop || !dep) return null

  const stopMonth = MONTHS[stop[2].toLowerCase()]
  const depMonth = MONTHS[dep[2].toLowerCase()]
  if (stopMonth === undefined || depMonth === undefined) return null

  const year = Number(dep[3])
  const depAt = Date.UTC(year, depMonth, Number(dep[1]))
  // A stop in an earlier month than departure is next year's side of New Year.
  const stopYear = stopMonth < depMonth ? year + 1 : year
  const stopAt = Date.UTC(stopYear, stopMonth, Number(stop[1]))
  return Math.round((stopAt - depAt) / 86_400_000)
}

/** "On Time" -> 0, "22 Min" -> 22, "01:20 Hr" -> 80. Anything else -> null. */
function parseDelay(value: string | undefined): number | null {
  if (!value) return null
  const v = value.trim()
  if (!v) return null
  if (/^on\s*time$/i.test(v)) return 0

  const hhmm = /^(\d{1,2}):(\d{2})\s*Hr$/i.exec(v)
  if (hhmm) return Number(hhmm[1]) * 60 + Number(hhmm[2])

  const mins = /^(\d{1,3})\s*Min$/i.exec(v)
  if (mins) return Number(mins[1])

  // Fail closed rather than guess: a delay we cannot read is not a delay of
  // zero, and reporting zero would quietly cancel the KOT warning.
  return null
}

/** Strips a "PF " prefix if one ever appears — the UI renders "PF {platform}" itself. */
function normalisePlatform(value: string | null | undefined): string | null {
  if (!value) return null
  const stripped = String(value).replace(/^PF\s*/i, '').trim()
  return stripped && stripped !== '-' ? stripped : null
}

/** 'YYYY-MM-DD' shifted by whole days, returned as RailKit's 'DD-MM-YYYY'. */
function shiftIsoDate(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1))
  dt.setUTCDate(dt.getUTCDate() + days)
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}-${mm}-${dt.getUTCFullYear()}`
}
