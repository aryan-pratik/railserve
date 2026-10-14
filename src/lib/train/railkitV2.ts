import { trackTrainV2 } from 'railkit'
import {
  RailKitTrainStatusProvider,
  type RailKitResponse,
  type RailKitStation,
  type RailKitTimes,
} from './railkit'

/**
 * Adapter for RailKit's v2 tracker (WIMT-backed), via `trackTrainV2` in the
 * SDK from 6.0.
 *
 * Verified against REAL responses for 16 runs on 13–14 Oct 2026 (12561, 22466
 * and trains due at CNB and GAYA). Rather than a second copy of the run
 * resolution, it translates v2's payload into the v1 shape the parent class
 * already reads, so the day-offset probing, the New Year rollover, the exact
 * station-code match and stopsAway are the same code for both.
 *
 * What differs from v1, and why the translation is shaped the way it is:
 *
 * 1. `startDate` is numeric ("13-10-2026") where v1 has "13-Oct-2026". The
 *    offset maths reads only the latter, and an unreadable departure date
 *    makes it accept whatever run answered first — today's train, not yet
 *    started, reported perfectly on time. So a startDate we cannot read
 *    rejects the whole response rather than passing through blank.
 *
 * 2. A halt with no time has `actual: null`, where v1 sends "--". It becomes
 *    "--" here, NOT the scheduled time: an empty reading is what lets the
 *    fallback ask v1 and lets the cache keep its last known ETA. Seen on
 *    12561 at CNB, the one stop of 21 with no actual.
 *
 * 3. `delay` is already minutes. v2 floors it at 0 for a train running
 *    early, while `actual` keeps the early time (16093 projected 17:52 for an
 *    18:25 arrival), so the ETA, not the delay, is what shows earliness.
 *
 * 4. Statuses are departed / at-station / upcoming. Only `departed` is final,
 *    which maps to v1's `passed`.
 *
 * 5. Each stop's `day` field is wrong (12561 reports day 1 at stops the next
 *    morning) and is ignored; the dates inside the time strings are right.
 */
export class RailKitV2TrainStatusProvider extends RailKitTrainStatusProvider {
  override readonly name: string = 'railkit-v2'

  protected override async request(trainNo: string, ddmmyyyy: string): Promise<RailKitResponse> {
    return toV1Shape((await trackTrainV2(trainNo, ddmmyyyy)) as V2Response)
  }
}

type V2Times = {
  scheduled?: string | null // "09:35 14-Oct", as v1
  actual?: string | null // same, "SRC" at the origin, null when unknown
  delay?: number | null // minutes, floored at 0; null at the origin
}

type V2Stop = {
  stnCode?: string
  stnName?: string
  isHalt?: boolean
  status?: string // "departed" | "at-station" | "upcoming"
  distance?: number | null // km from origin
  platform?: string | null
  arrival?: V2Times
}

type V2Response = {
  success?: boolean
  error?: unknown
  data?: {
    startDate?: string // "13-10-2026"
    lastUpdatedAt?: string // "Oct 14, 2026, 16:56", IST
    trainInfo?: { name?: string }[]
    statusText?: string
    currentLocation?: { stnCode?: string } | null
    route?: V2Stop[]
  }
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const STATUS: Record<string, string> = {
  departed: 'passed',
  'at-station': 'current',
  upcoming: 'upcoming',
}

/** Exported for tests. */
export function toV1Shape(body: V2Response): RailKitResponse {
  if (!body.success) return { success: false, error: body.error as string | undefined }

  const data = body.data
  const date = startDateToV1(data?.startDate)
  if (!date) {
    // See note 1: fail closed. The parent turns this into TrainStatusUnavailable.
    return { success: false, error: `v2 sent an unreadable startDate: ${JSON.stringify(data?.startDate)}` }
  }

  return {
    success: true,
    data: {
      date,
      trainName: data?.trainInfo?.[0]?.name,
      statusNote: data?.statusText,
      lastUpdate: lastUpdatedToV1(data?.lastUpdatedAt),
      currentStationCode: data?.currentLocation?.stnCode,
      timeline: (data?.route ?? []).map(toV1Station),
    },
  }
}

function toV1Station(s: V2Stop): RailKitStation {
  return {
    type: s.isHalt ? 'stoppage' : 'intermediate',
    status: s.status ? STATUS[s.status] : undefined,
    stationCode: s.stnCode,
    stationName: s.stnName,
    platform: s.platform ?? undefined,
    distanceKm: typeof s.distance === 'number' ? String(s.distance) : undefined,
    arrival: toV1Times(s.arrival),
  }
}

function toV1Times(t: V2Times | undefined): RailKitTimes | undefined {
  if (!t) return undefined
  return {
    scheduled: t.scheduled ?? undefined,
    // See note 2: "--" reads as no time, never as the timetable.
    actual: t.actual ?? '--',
    delay: typeof t.delay === 'number' ? `${Math.max(0, Math.round(t.delay))} Min` : '',
  }
}

/** "13-10-2026" -> "13-Oct-2026", or null if it is not that shape. */
function startDateToV1(value: string | undefined): string | null {
  const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(value?.trim() ?? '')
  const month = m ? MONTH_ABBR[Number(m[2]) - 1] : undefined
  return m && month ? `${m[1].padStart(2, '0')}-${month}-${m[3]}` : null
}

/** "Oct 14, 2026, 16:56" -> "14-Oct-2026 16:56"; anything else -> "" (no update time). */
function lastUpdatedToV1(value: string | undefined): string {
  const m = /^([A-Za-z]{3}) (\d{1,2}), (\d{4}),? (\d{1,2}):(\d{2})$/.exec(value?.trim() ?? '')
  if (!m) return ''
  const month = MONTH_ABBR.find((a) => a.toLowerCase() === m[1].toLowerCase())
  return month ? `${m[2].padStart(2, '0')}-${month}-${m[3]} ${m[4].padStart(2, '0')}:${m[5]}` : ''
}
