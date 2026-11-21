import { NO_OUTLET, NO_PAYMENT, NO_RIDER, OUTCOME_STATUSES, analyticsParams, hasAnalyticsFilters, isOutcome, readAnalyticsFilters, type AnalyticsFilters, type Outcome } from '@/lib/analytics'
import type { DateFilterMode } from '@/lib/dateFilter'
import { PAGE_SIZES } from '@/components/v2/Table'

/*
 * The v2 Analytics page's links. The vocabulary (outcomes, filters, tallies,
 * the time series) stays in lib/analytics.ts; this only decides where a
 * click goes and what the URL carries.
 */

/** The words the v2 screens use for the five outcomes. */
export const OUTCOME_WORD: Record<Outcome, string> = {
  delivered: 'Delivered',
  progress: 'In progress',
  undelivered: 'Not delivered',
  cancelled: 'Cancelled',
  other: 'Other',
}

/**
 * How each outcome is drawn, as on the dashboard: delivered is the solid
 * brand, in progress is hatched (not yet), and what never reached the
 * passenger is grey, darker for a failed delivery than for a cancellation.
 * Never a second colour per status.
 */
export const OUTCOME_SWATCH: Record<Outcome, string> = {
  delivered: 'bg-v2-brand',
  progress: 'v2-hatch border border-v2-line-strong',
  undelivered: 'bg-v2-muted',
  cancelled: 'bg-v2-line-strong',
  other: 'bg-v2-surface-2 border border-v2-line-strong',
}

type Over = Parameters<typeof analyticsParams>[1]

const V2_MODES: readonly string[] = ['today', 'yesterday', 'month', 'custom-month', 'range'] satisfies DateFilterMode[]

/**
 * The v2 page opens on today, like every dated v2 screen, where the v1 reader
 * opens on the month. Anything the URL does not say, or says wrongly, is today.
 */
export function readV2AnalyticsFilters(sp: Parameters<typeof readAnalyticsFilters>[0]): AnalyticsFilters {
  const raw = Array.isArray(sp.mode) ? sp.mode[0] : sp.mode
  return readAnalyticsFilters(V2_MODES.includes(raw ?? '') ? sp : { ...sp, mode: 'today' })
}

/** Whether anything beyond today is narrowing the view. */
export function hasV2AnalyticsFilters(f: AnalyticsFilters): boolean {
  return hasAnalyticsFilters({ ...f, mode: 'month' }) || f.mode !== 'today'
}

/**
 * The filters as this page's params. The v1 helper leaves the month out as
 * its default; here today is the default, so the month is written and today
 * is not.
 */
export function v2AnalyticsParams(f: AnalyticsFilters, over: Over = {}): URLSearchParams {
  const u = analyticsParams(f, over)
  const mode = over.mode === undefined ? f.mode : over.mode
  if (mode === 'today' || mode === '') u.delete('mode')
  else u.set('mode', mode)
  return u
}

/** This page, with the filters changed; `extra` adds the pager's own params. */
export function analyticsHref(f: AnalyticsFilters, over: Over = {}, extra: Record<string, string> = {}): string {
  const u = v2AnalyticsParams(f, over)
  for (const [k, v] of Object.entries(extra)) if (v) u.set(k, v)
  const qs = u.toString()
  return `/v2/analytics${qs ? `?${qs}` : ''}`
}

/** The v1 export route, which already reads the same query string. */
export function exportHref(f: AnalyticsFilters, report: 'orders' | 'summary'): string {
  const u = analyticsParams(f, { by: f.by })
  u.set('report', report)
  return `/admin/analytics/export?${u}`
}

/**
 * The same view as a list of orders on /v2/orders. It opens the All view,
 * the only one whose dates come from the URL, with the date as an explicit
 * range so the orders table need not know this page's modes. The orders
 * table takes one status, so an outcome goes as its status when it has one
 * (delivered), as the Cancelled view when that view is the outcome
 * (cancelled, not delivered), and otherwise as every status in the range.
 * "Unassigned outlet" and "payment not recorded" have no orders filter and
 * are left off: the list is then wider than the figure, never empty.
 */
export function ordersHref(f: AnalyticsFilters, over: Over = {}): string {
  const u = new URLSearchParams()
  const status = over.status ?? f.status
  const cancelledView = status === 'cancelled' || status === 'undelivered'
  u.set('view', cancelledView ? 'cancelled' : 'all')
  u.set('mode', 'range')
  u.set('from', over.from ?? f.from)
  u.set('to', over.to ?? f.to)
  const outlet = over.outlet ?? f.outlet
  const source = over.source ?? f.source
  const payment = over.payment ?? f.payment
  const rider = over.rider ?? f.rider
  const type = over.type ?? f.type
  if (outlet && outlet !== NO_OUTLET) u.set('outlet', outlet)
  for (const s of over.stations ?? f.stations) u.append('station', s)
  if (source) u.set('source', source)
  if (payment && payment !== NO_PAYMENT) u.set('payment', payment)
  if (rider) u.set('rider', rider === NO_RIDER ? 'none' : rider)
  if (type) u.set('type', type)
  if (status) {
    if (!isOutcome(status)) u.set('status', status)
    else if (!cancelledView && status !== 'other' && OUTCOME_STATUSES[status].length === 1) u.set('status', OUTCOME_STATUSES[status][0])
  }
  return `/v2/orders?${u}`
}

type Params = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''

/** The breakdown's own pager (`bp`, `bps`), separate from the orders table's. */
export function readBreakdownPaging(sp: Params): { page: number; pageSize: number } {
  const page = Math.max(1, Number.parseInt(one(sp.bp), 10) || 1)
  const requested = Number.parseInt(one(sp.bps), 10)
  const pageSize = (PAGE_SIZES as readonly number[]).includes(requested) ? requested : PAGE_SIZES[0]
  return { page, pageSize }
}
