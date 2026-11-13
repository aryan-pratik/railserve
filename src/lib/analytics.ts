import { ORDER_SOURCES, ORDER_TYPES, PAYMENT_MODES } from './orderEnums'
import { resolveDateRange, type DateFilterMode } from './dateFilter'
import { todayIST } from './format'

/**
 * The admin Analytics screen's vocabulary: how eighteen statuses fold into
 * the five outcomes a person reads, what the URL's filters mean, and how
 * counted rows become a chart and a table.
 *
 * Pure, with no database in it, so the page, the export and the tests all
 * read the same rules. The queries themselves live in repo/analyticsRepo.
 */

/* ── outcomes ─────────────────────────────────────────────────────────────── */

export const OUTCOMES = ['delivered', 'progress', 'undelivered', 'cancelled', 'other'] as const
export type Outcome = (typeof OUTCOMES)[number]

export const OUTCOME_LABEL: Record<Outcome, string> = {
  delivered: 'Delivered',
  progress: 'In progress',
  undelivered: 'Undelivered',
  cancelled: 'Cancelled',
  other: 'Other',
}

/**
 * Which statuses make up each outcome. `other` is open-ended: REFUNDED, plus
 * any custom status an admin has typed in, so a new one is counted somewhere
 * the day it appears rather than vanishing from the totals.
 */
export const OUTCOME_STATUSES: Record<Exclude<Outcome, 'other'>, readonly string[]> = {
  delivered: ['DELIVERED'],
  progress: ['ENQUIRY', 'QUOTED', 'RECEIVED', 'ACCEPTED', 'KOT_PRINTED', 'PREPARED', 'DISPATCHED'],
  undelivered: ['FAILED', 'MISSED_DELIVERY', 'MISDELIVERY'],
  cancelled: ['CANCELLED', 'LOST'],
}

/**
 * Decoys run to prompt an app-store rating. Not business, so they are left
 * out of every figure on the screen, not merely out of "delivered".
 */
export const EXCLUDED_STATUS = 'RATING_ORDER'

const STATUS_OUTCOME = new Map<string, Outcome>(
  (Object.entries(OUTCOME_STATUSES) as [Outcome, readonly string[]][]).flatMap(([o, list]) =>
    list.map((s) => [s, o] as const),
  ),
)

export function outcomeOf(status: string): Outcome {
  return STATUS_OUTCOME.get(status) ?? 'other'
}

export function isOutcome(value: string): value is Outcome {
  return (OUTCOMES as readonly string[]).includes(value)
}

/* ── filters ──────────────────────────────────────────────────────────────── */

export const DIMENSIONS = ['outlet', 'station', 'source', 'payment', 'status', 'day'] as const
export type Dimension = (typeof DIMENSIONS)[number]

export const DIMENSION_LABEL: Record<Dimension, string> = {
  outlet: 'Outlet',
  station: 'Station',
  source: 'Aggregator',
  payment: 'Payment',
  status: 'Status',
  day: 'Day',
}

/** The outlet filter's value for orders no outlet has been matched to. */
export const NO_OUTLET = 'none'
/** The payment filter's value for orders with no payment mode recorded. */
export const NO_PAYMENT = 'none'

export type AnalyticsFilters = {
  mode: DateFilterMode
  month: string
  /** The raw range fields, as the date control wrote them. */
  rawFrom: string
  rawTo: string
  /** The resolved, always-bounded `serviceDate` range every figure reads. */
  from: string
  to: string
  outlet: string
  stations: string[]
  source: string
  payment: string
  type: string
  /** An exact status (upper case) or an outcome key (lower case); '' for any. */
  status: string
  by: Dimension
  /** Whether `by` came from the URL, rather than the default applying. */
  bySet: boolean
}

type Params = Record<string, string | string[] | undefined>

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''
const many = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : [])

const ANALYTICS_MODES: readonly DateFilterMode[] = ['today', 'yesterday', 'month', 'custom-month', 'range']
const YMD = /^\d{4}-\d{2}-\d{2}$/
const YM = /^\d{4}-\d{2}$/

/**
 * Reads the screen's filters from the URL. Anything unrecognised is dropped
 * rather than passed on, so a stale or hand-edited link shows a wider view
 * instead of an empty one or an error.
 */
export function readAnalyticsFilters(sp: Params): AnalyticsFilters {
  const rawMode = one(sp.mode) as DateFilterMode
  const mode = ANALYTICS_MODES.includes(rawMode) ? rawMode : 'month'
  const month = YM.test(one(sp.month)) ? one(sp.month) : ''
  const rawFrom = YMD.test(one(sp.from)) ? one(sp.from) : ''
  const rawTo = YMD.test(one(sp.to)) ? one(sp.to) : ''
  const resolved = resolveDateRange(mode, { month, from: rawFrom, to: rawTo })
  // Analytics always reads a bounded range: a half-filled custom range closes
  // on the end that was given, and an empty one falls back to today.
  let from = resolved.from || resolved.to || todayIST()
  let to = resolved.to || resolved.from || todayIST()
  if (from > to) [from, to] = [to, from]

  const outlet = one(sp.outlet)
  const source = one(sp.source)
  const payment = one(sp.payment)
  const type = one(sp.type)
  const status = one(sp.status).trim()
  const rawBy = one(sp.by) as Dimension
  const bySet = DIMENSIONS.includes(rawBy)
  const outletOk = outlet === NO_OUTLET || /^[a-f0-9]{24}$/i.test(outlet)

  const filters: AnalyticsFilters = {
    mode,
    month,
    rawFrom,
    rawTo,
    from,
    to,
    outlet: outletOk ? outlet : '',
    stations: [...new Set(many(sp.station).map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9]{1,8}$/.test(s)))],
    source: (ORDER_SOURCES as readonly string[]).includes(source) ? source : '',
    payment: payment === NO_PAYMENT || (PAYMENT_MODES as readonly string[]).includes(payment) ? payment : '',
    type: (ORDER_TYPES as readonly string[]).includes(type) ? type : '',
    status: status && status !== EXCLUDED_STATUS && status.length <= 60 ? status : '',
    by: 'outlet',
    bySet,
  }
  // A dimension already narrowed to one value makes a table of one row, so
  // the comparison opens on the first dimension that is still open.
  filters.by = bySet
    ? rawBy
    : !filters.outlet ? 'outlet'
    : !filters.source ? 'source'
    : !filters.stations.length ? 'station'
    : !filters.payment ? 'payment'
    : 'day'
  return filters
}

/** Whether anything beyond the default date range is narrowing the view. */
export function hasAnalyticsFilters(f: AnalyticsFilters): boolean {
  return Boolean(f.outlet || f.stations.length || f.source || f.payment || f.type || f.status || f.mode !== 'month')
}

/**
 * The filters as query params, for every link that must carry them: tiles,
 * table rows, pagers, the export. `over` replaces single fields; a blank
 * value removes one.
 */
export function analyticsParams(
  f: AnalyticsFilters,
  over: Partial<Record<'outlet' | 'source' | 'payment' | 'type' | 'status' | 'by' | 'mode' | 'from' | 'to', string>> & {
    stations?: string[]
  } = {},
): URLSearchParams {
  const u = new URLSearchParams()
  const mode = over.mode ?? (f.mode === 'month' ? '' : f.mode)
  const pairs: [string, string][] = [
    ['mode', mode],
    ['month', mode === 'custom-month' ? f.month : ''],
    ['from', mode === 'range' ? (over.from ?? f.rawFrom) : ''],
    ['to', mode === 'range' ? (over.to ?? f.rawTo) : ''],
    ['outlet', over.outlet ?? f.outlet],
    ['source', over.source ?? f.source],
    ['payment', over.payment ?? f.payment],
    ['type', over.type ?? f.type],
    ['status', over.status ?? f.status],
    ['by', over.by ?? (f.bySet ? f.by : '')],
  ]
  for (const [k, v] of pairs) if (v) u.set(k, v)
  for (const s of over.stations ?? f.stations) u.append('station', s)
  return u
}

/* ── counting ─────────────────────────────────────────────────────────────── */

/** One group out of the database: a key (a day, an outlet…), a status, and its sums. */
export type CountRow = { key: string | null; status: string; orders: number; amountPaise: number }

export type OutcomeCounts = Record<Outcome, number>

export const zeroCounts = (): OutcomeCounts => ({ delivered: 0, progress: 0, undelivered: 0, cancelled: 0, other: 0 })

export type Tally = {
  key: string | null
  total: number
  counts: OutcomeCounts
  /** Bill value of every order in the group. */
  amountPaise: number
  /** Bill value of the delivered ones: what the group actually earned. */
  deliveredPaise: number
}

/** Folds per-status rows into one tally per key, busiest first. */
export function tallyByKey(rows: CountRow[]): Tally[] {
  const byKey = new Map<string | null, Tally>()
  for (const r of rows) {
    let t = byKey.get(r.key)
    if (!t) {
      t = { key: r.key, total: 0, counts: zeroCounts(), amountPaise: 0, deliveredPaise: 0 }
      byKey.set(r.key, t)
    }
    const outcome = outcomeOf(r.status)
    t.total += r.orders
    t.counts[outcome] += r.orders
    t.amountPaise += r.amountPaise
    if (outcome === 'delivered') t.deliveredPaise += r.amountPaise
  }
  return [...byKey.values()].sort((a, b) => b.total - a.total || String(a.key).localeCompare(String(b.key)))
}

/** Every row as one tally: the totals line. */
export function tallyAll(rows: CountRow[]): Tally {
  return tallyByKey(rows.map((r) => ({ ...r, key: null })))[0] ?? {
    key: null, total: 0, counts: zeroCounts(), amountPaise: 0, deliveredPaise: 0,
  }
}

/** "62%", or a dash when there is nothing to take a share of. */
export function share(n: number, of: number): string {
  return of === 0 ? '-' : `${Math.round((n / of) * 100)}%`
}

/* ── the time series ──────────────────────────────────────────────────────── */

export type Granularity = 'day' | 'week' | 'month'

export type Bucket = {
  /** First service date in the bucket. */
  key: string
  /** Short axis label: "13", "1 Nov", "Nov". */
  label: string
  /** Full name for the tooltip: "Fri 13 Nov 2026", "9 – 15 Nov 2026". */
  title: string
  total: number
  counts: OutcomeCounts
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_MS = 24 * 60 * 60 * 1000

// Service dates are calendar days with no time in them, so all the arithmetic
// is done at UTC midnight, where a day is always exactly 24 hours.
const toUtc = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`)
const toYmd = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS) + 1
}

/** Bars thin enough to read: days up to six weeks, weeks up to six months, then months. */
export function granularityFor(from: string, to: string): Granularity {
  const days = daysBetween(from, to)
  return days <= 45 ? 'day' : days <= 190 ? 'week' : 'month'
}

function dayTitle(ms: number): string {
  const d = new Date(ms)
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/**
 * Lays day counts out along the whole range, a bucket for every day, week or
 * month in it whether or not anything was ordered. A quiet day is drawn as a
 * gap rather than skipped, so the axis keeps telling the truth about time.
 */
export function buildSeries(rows: CountRow[], from: string, to: string): { granularity: Granularity; buckets: Bucket[] } {
  const granularity = granularityFor(from, to)
  const start = toUtc(from)
  const end = toUtc(to)
  const buckets: Bucket[] = []
  const indexOfDay = new Map<string, number>()

  let cursor = start
  while (cursor <= end) {
    const d = new Date(cursor)
    let last: number
    if (granularity === 'day') last = cursor
    else if (granularity === 'week') last = cursor + 6 * DAY_MS
    else last = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)
    last = Math.min(last, end)
    const l = new Date(last)

    let label: string
    let title: string
    if (granularity === 'day') {
      label = d.getUTCDate() === 1 || cursor === start ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` : String(d.getUTCDate())
      title = dayTitle(cursor)
    } else if (granularity === 'week') {
      label = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
      title =
        d.getUTCMonth() === l.getUTCMonth()
          ? `${d.getUTCDate()} – ${l.getUTCDate()} ${MONTHS[l.getUTCMonth()]} ${l.getUTCFullYear()}`
          : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} – ${l.getUTCDate()} ${MONTHS[l.getUTCMonth()]} ${l.getUTCFullYear()}`
    } else {
      label = d.getUTCMonth() === 0 || cursor === start ? `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}` : MONTHS[d.getUTCMonth()]
      title = `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
    }

    for (let day = cursor; day <= last; day += DAY_MS) indexOfDay.set(toYmd(day), buckets.length)
    buckets.push({ key: toYmd(cursor), label, title, total: 0, counts: zeroCounts() })
    cursor = last + DAY_MS
  }

  for (const r of rows) {
    const i = r.key ? indexOfDay.get(r.key) : undefined
    if (i === undefined) continue
    buckets[i].total += r.orders
    buckets[i].counts[outcomeOf(r.status)] += r.orders
  }
  return { granularity, buckets }
}

/** Round an axis up to something a person would have chosen: 5, 20, 50, 200… */
export function niceCeil(n: number): number {
  if (n <= 4) return 4
  const mag = 10 ** Math.floor(Math.log10(n))
  const r = n / mag
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 4 ? 4 : r <= 5 ? 5 : 10) * mag
}
