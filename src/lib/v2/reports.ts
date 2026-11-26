/*
 * Reports for an owner: what sold, when, where from, and where money leaked.
 * Pure functions over a slim list of orders (repo/reportsRepo), so every
 * figure can be unit-tested and every screen counts the same way.
 *
 * What counts (the same rules as the rest of the app):
 * - The day is the order's serviceDate. Hours are IST.
 * - Rating-order decoys are not business: left out of everything except the
 *   "rating orders" line under Money lost, which says what they cost.
 * - Sales are the bill of every order that was not cancelled and not
 *   "not delivered": delivered, plus orders staff never closed (most of those
 *   were delivered and simply not marked). How much is still unclosed is
 *   shown beside it, never hidden.
 * - Aggregator emails carry no price per dish, so dishes are counted by how
 *   many were sold, never by money. Bulk (group) orders are counted apart, or
 *   one 75-plate thali would top every list.
 * - A refund is money lost only when we paid it ourselves.
 */

import { isMenuDish, menuKey } from '../diet'
import { shiftServiceDate } from '../format'

export type ReportOrder = {
  serviceDate: string
  createdAt: Date
  /** Scheduled train arrival: when the food is needed. */
  arrival: Date | null
  status: string
  amountPaise: number
  paymentMode: string | null
  source: string | null
  orderType: string
  outletId: string | null
  stationCode: string | null
  trainNo: string | null
  trainName: string | null
  phone: string | null
  ratingOrder: boolean
  refundPaise: number
  refundByUs: boolean
  items: { name: string; qty: number; isPacking: boolean; spec: string | null }[]
  /** The kitchen printed its ticket: the food was made. */
  cooked: boolean
  deliveredAt: Date | null
  dispatchedAt: Date | null
  failureReason: string | null
  riderId: string | null
  returned: boolean
}

const CANCELLED = new Set(['CANCELLED', 'LOST'])
const isCancelled = (o: ReportOrder) => CANCELLED.has(o.status)
const isFailed = (o: ReportOrder) => o.status === 'FAILED'
/** Counted as a sale: not cancelled and not "not delivered". */
export const isSale = (o: ReportOrder) => !o.ratingOrder && !isCancelled(o) && !isFailed(o)

/* ── the period and the one it is compared with ─────────────────────────── */

export type ReportMode = 'today' | 'yesterday' | 'week' | 'month' | 'range'

export type ReportPeriod = {
  mode: ReportMode
  from: string
  to: string
  prevFrom: string
  prevTo: string
  days: string[]
  /** "the same days last week": what a change is measured against. */
  versus: string
}

function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to && out.length < 400; d = shiftServiceDate(d, 1)) out.push(d)
  return out
}

function weekdayOf(day: string): number {
  return (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7 // 0 = Monday
}

/**
 * Like for like: this week so far against the same weekdays last week, this
 * month so far against the same dates last month, a chosen range against as
 * many days just before it.
 */
export function reportPeriod(mode: string, opts: { from?: string; to?: string }, today: string): ReportPeriod {
  const ymd = /^\d{4}-\d{2}-\d{2}$/
  const make = (m: ReportMode, from: string, to: string, prevFrom: string, prevTo: string, versus: string): ReportPeriod => ({
    mode: m, from, to, prevFrom, prevTo, days: daysBetween(from, to), versus,
  })
  switch (mode) {
    case 'today':
      return make('today', today, today, shiftServiceDate(today, -7), shiftServiceDate(today, -7), 'the same day last week')
    case 'yesterday': {
      const d = shiftServiceDate(today, -1)
      return make('yesterday', d, d, shiftServiceDate(d, -7), shiftServiceDate(d, -7), 'the same day the week before')
    }
    case 'month': {
      const from = `${today.slice(0, 7)}-01`
      const [y, m] = today.split('-').map(Number)
      const prevMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
      const lastDay = new Date(Date.UTC(Number(prevMonth.slice(0, 4)), Number(prevMonth.slice(5, 7)), 0)).getUTCDate()
      const day = Math.min(Number(today.slice(8, 10)), lastDay)
      return make('month', from, today, `${prevMonth}-01`, `${prevMonth}-${String(day).padStart(2, '0')}`, 'the same dates last month')
    }
    case 'range': {
      let from = ymd.test(opts.from ?? '') ? opts.from! : today
      let to = ymd.test(opts.to ?? '') ? opts.to! : from
      if (to < from) [from, to] = [to, from]
      if (to > today) to = today
      if (from > to) from = to
      const n = daysBetween(from, to).length
      return make('range', from, to, shiftServiceDate(from, -n), shiftServiceDate(from, -1), `the ${n} day${n === 1 ? '' : 's'} before`)
    }
    case 'week':
    default: {
      const from = shiftServiceDate(today, -weekdayOf(today))
      return make('week', from, today, shiftServiceDate(from, -7), shiftServiceDate(today, -7), 'the same days last week')
    }
  }
}

/** Percent change, rounded; null when there is nothing to compare with. */
export function change(now: number, before: number): number | null {
  if (before <= 0) return null
  return Math.round(((now - before) / before) * 100)
}

/* ── IST clock ──────────────────────────────────────────────────────────── */

const IST_MS = 330 * 60_000
export function istHour(d: Date): number {
  return new Date(d.getTime() + IST_MS).getUTCHours()
}
export function istWeekday(d: Date): number {
  return (new Date(d.getTime() + IST_MS).getUTCDay() + 6) % 7
}
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
export const WEEKDAY_NAMES = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'] as const
/** "12–2 pm", "11 am–1 pm": a short span of hours. */
export function hourSpan(from: number, to: number): string {
  const [a, b] = [hourLabel(from), hourLabel(to)]
  const sa = a.slice(-2)
  return sa === b.slice(-2) ? `${a.slice(0, -3)}–${b}` : `${a}–${b}`
}
export function hourLabel(h: number): string {
  const x = ((h % 24) + 24) % 24
  return x === 0 ? '12 am' : x < 12 ? `${x} am` : x === 12 ? '12 pm' : `${x - 12} pm`
}

/* ── headline figures ───────────────────────────────────────────────────── */

export type Headline = {
  orders: number
  salesPaise: number
  deliveredPaise: number
  /** Sales on orders nobody marked delivered or not. */
  unclosedOrders: number
  unclosedPaise: number
  avgPaise: number
  cashPaise: number
  onlinePaise: number
  /** Cancelled or not delivered after the food was made, plus refunds we paid. */
  lostPaise: number
}

export function headline(orders: ReportOrder[]): Headline {
  const sales = orders.filter(isSale)
  const sum = (list: ReportOrder[]) => list.reduce((s, o) => s + o.amountPaise, 0)
  const salesPaise = sum(sales)
  const delivered = sales.filter((o) => o.status === 'DELIVERED')
  const unclosed = sales.filter((o) => o.status !== 'DELIVERED')
  const l = losses(orders)
  return {
    orders: sales.length,
    salesPaise,
    deliveredPaise: sum(delivered),
    unclosedOrders: unclosed.length,
    unclosedPaise: sum(unclosed),
    avgPaise: sales.length ? Math.round(salesPaise / sales.length) : 0,
    cashPaise: sum(sales.filter((o) => o.paymentMode === 'COD')),
    onlinePaise: sum(sales.filter((o) => o.paymentMode !== 'COD')),
    lostPaise: l.cookedLost.paise + l.refundsUs.paise,
  }
}

/** Sales per day; for a single day, per hour of train arrival. */
export function salesSeries(orders: ReportOrder[], period: ReportPeriod): { key: string; label: string; paise: number; orders: number }[] {
  const sales = orders.filter(isSale)
  if (period.days.length === 1) {
    const rows = Array.from({ length: 24 }, (_, h) => ({ key: String(h), label: hourLabel(h), paise: 0, orders: 0 }))
    for (const o of sales) {
      const h = istHour(o.arrival ?? o.createdAt)
      rows[h].paise += o.amountPaise
      rows[h].orders += 1
    }
    // Trim the quiet ends of the day, keeping a little either side.
    const busy = rows.map((r, i) => (r.orders ? i : -1)).filter((i) => i >= 0)
    if (busy.length === 0) return rows.slice(6, 24)
    return rows.slice(Math.max(0, busy[0] - 1), Math.min(24, busy[busy.length - 1] + 2))
  }
  const byDay = new Map(period.days.map((d) => [d, { key: d, label: d, paise: 0, orders: 0 }]))
  for (const o of sales) {
    const row = byDay.get(o.serviceDate)
    if (row) {
      row.paise += o.amountPaise
      row.orders += 1
    }
  }
  return [...byDay.values()]
}

/* ── dishes ─────────────────────────────────────────────────────────────── */

/**
 * One key per dish across spellings an aggregator varies: case, spacing,
 * a trailing "(veg)" / "(non-veg)" tag, "spl" for "special". Nothing riskier:
 * two different dishes must never be merged by a guess.
 */
export function dishKey(name: string): string {
  return menuKey(name)
    .replace(/\s*\((?:pure\s+)?(?:veg|non[\s-]?veg)\)\s*$/, '')
    .replace(/\bspl\b\.?/g, 'special')
    .replace(/\s+/g, ' ')
    .trim()
}

export type DishStat = {
  key: string
  name: string
  qty: number
  orders: number
  prevQty: number
  change: number | null
  byHour: number[]
  byWeekday: number[]
  byDay: Map<string, number>
}

/** Orders whose dishes count: not decoys, not bulk, and the food was ordered for real (not cancelled before cooking). */
const dishOrder = (o: ReportOrder) => !o.ratingOrder && o.orderType !== 'BULK' && !(isCancelled(o) && !o.cooked)

function countDishes(orders: ReportOrder[]) {
  const map = new Map<string, { names: Map<string, number>; qty: number; orders: number; byHour: number[]; byWeekday: number[]; byDay: Map<string, number> }>()
  for (const o of orders) {
    if (!dishOrder(o)) continue
    const when = o.arrival ?? o.createdAt
    const seen = new Set<string>()
    for (const i of o.items) {
      if (!isMenuDish(i)) continue
      const key = dishKey(i.name)
      if (!key) continue
      let d = map.get(key)
      if (!d) {
        d = { names: new Map(), qty: 0, orders: 0, byHour: Array(24).fill(0), byWeekday: Array(7).fill(0), byDay: new Map() }
        map.set(key, d)
      }
      const qty = Math.max(1, i.qty || 1)
      d.qty += qty
      d.names.set(i.name.trim(), (d.names.get(i.name.trim()) ?? 0) + qty)
      d.byHour[istHour(when)] += qty
      d.byWeekday[weekdayOf(o.serviceDate)] += qty
      d.byDay.set(o.serviceDate, (d.byDay.get(o.serviceDate) ?? 0) + qty)
      if (!seen.has(key)) {
        d.orders += 1
        seen.add(key)
      }
    }
  }
  return map
}

/** "Veg Mini Thali": the spelling used most, in title case when it arrived shouting. */
function displayName(names: Map<string, number>): string {
  const best = ([...names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '').replace(/\s*\((?:pure\s+)?(?:veg|non[\s-]?veg)\)\s*$/i, '')
  return best === best.toUpperCase() ? best.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : best
}

export function dishStats(current: ReportOrder[], previous: ReportOrder[]): { dishes: DishStat[]; stopped: { name: string; prevQty: number }[] } {
  const now = countDishes(current)
  const before = countDishes(previous)
  const dishes: DishStat[] = [...now.entries()]
    .map(([key, d]) => {
      const prevQty = before.get(key)?.qty ?? 0
      return { key, name: displayName(d.names), qty: d.qty, orders: d.orders, prevQty, change: change(d.qty, prevQty), byHour: d.byHour, byWeekday: d.byWeekday, byDay: d.byDay }
    })
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name))
  const stopped = [...before.entries()]
    .filter(([key, d]) => !now.has(key) && d.qty >= 2)
    .map(([, d]) => ({ name: displayName(d.names), prevQty: d.qty }))
    .sort((a, b) => b.prevQty - a.prevQty)
  return { dishes, stopped }
}

/** Bulk (group) orders, counted apart: how many, how many plates, their value. */
export function bulkSummary(orders: ReportOrder[]): { orders: number; plates: number; paise: number } {
  const bulk = orders.filter((o) => isSale(o) && o.orderType === 'BULK')
  return {
    orders: bulk.length,
    plates: bulk.reduce((s, o) => s + o.items.reduce((n, i) => n + (i.isPacking ? 0 : i.qty || 0), 0), 0),
    paise: bulk.reduce((s, o) => s + o.amountPaise, 0),
  }
}

/* ── busy times ─────────────────────────────────────────────────────────── */

/** Orders by weekday and hour the train arrives (when food must be ready). 7 × 24. */
export function busyGrid(orders: ReportOrder[]): number[][] {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0) as number[])
  for (const o of orders) {
    if (!isSale(o) && !o.cooked) continue
    if (o.ratingOrder) continue
    const when = o.arrival ?? o.createdAt
    grid[weekdayOf(o.serviceDate)][istHour(when)] += 1
  }
  return grid
}

/** Orders by the hour they came in: when the call desk and inbox are busiest. */
export function placedByHour(orders: ReportOrder[]): number[] {
  const out = Array(24).fill(0) as number[]
  for (const o of orders) if (!o.ratingOrder) out[istHour(o.createdAt)] += 1
  return out
}

/** The busiest two-hour window across the week, by arrival. */
export function busiestSlot(grid: number[][]): { weekday: number; hour: number; orders: number } | null {
  let best: { weekday: number; hour: number; orders: number } | null = null
  for (let w = 0; w < 7; w++) {
    for (let h = 0; h < 23; h++) {
      const n = grid[w][h] + grid[w][h + 1]
      if (n > 0 && (!best || n > best.orders)) best = { weekday: w, hour: h, orders: n }
    }
  }
  return best
}

/* ── where orders come from ─────────────────────────────────────────────── */

export type GroupStat = { key: string; orders: number; salesPaise: number; avgPaise: number; lost: number; lostRate: number; share: number }

/** Orders and sales grouped by any field: aggregator, kitchen, station, train. */
export function groupBy(orders: ReportOrder[], keyOf: (o: ReportOrder) => string | null): GroupStat[] {
  const real = orders.filter((o) => !o.ratingOrder)
  const total = real.filter(isSale).reduce((s, o) => s + o.amountPaise, 0)
  const map = new Map<string, { all: number; sales: number; paise: number; lost: number }>()
  for (const o of real) {
    const k = keyOf(o) ?? '—'
    const g = map.get(k) ?? { all: 0, sales: 0, paise: 0, lost: 0 }
    g.all += 1
    if (isSale(o)) {
      g.sales += 1
      g.paise += o.amountPaise
    } else g.lost += 1
    map.set(k, g)
  }
  return [...map.entries()]
    .map(([key, g]) => ({
      key,
      orders: g.sales,
      salesPaise: g.paise,
      avgPaise: g.sales ? Math.round(g.paise / g.sales) : 0,
      lost: g.lost,
      lostRate: g.all ? Math.round((g.lost / g.all) * 100) : 0,
      share: total ? Math.round((g.paise / total) * 100) : 0,
    }))
    .sort((a, b) => b.salesPaise - a.salesPaise || b.orders - a.orders)
}

/* ── money lost ─────────────────────────────────────────────────────────── */

export type Losses = {
  /** The food was made, then the order was cancelled or not delivered. */
  cookedLost: { orders: number; paise: number }
  notDelivered: { orders: number; paise: number; reasons: { reason: string; orders: number }[] }
  /** Cancelled before cooking: a lost sale, but no food wasted. */
  cancelledEarly: { orders: number; paise: number }
  refundsUs: { orders: number; paise: number }
  refundsAggregator: { orders: number; paise: number }
  rating: { orders: number; paise: number }
  returnedBags: number
}

export function losses(orders: ReportOrder[]): Losses {
  const real = orders.filter((o) => !o.ratingOrder)
  const sum = (list: ReportOrder[]) => ({ orders: list.length, paise: list.reduce((s, o) => s + o.amountPaise, 0) })
  const failed = real.filter(isFailed)
  const reasons = new Map<string, number>()
  for (const o of failed) {
    const r = readableReason(o.failureReason)
    reasons.set(r, (reasons.get(r) ?? 0) + 1)
  }
  const refunded = real.filter((o) => o.refundPaise > 0)
  const refundSum = (list: ReportOrder[]) => ({ orders: list.length, paise: list.reduce((s, o) => s + o.refundPaise, 0) })
  return {
    cookedLost: sum(real.filter((o) => (isCancelled(o) || isFailed(o)) && o.cooked)),
    notDelivered: { ...sum(failed), reasons: [...reasons.entries()].map(([reason, n]) => ({ reason, orders: n })).sort((a, b) => b.orders - a.orders) },
    cancelledEarly: sum(real.filter((o) => isCancelled(o) && !o.cooked)),
    refundsUs: refundSum(refunded.filter((o) => o.refundByUs)),
    refundsAggregator: refundSum(refunded.filter((o) => !o.refundByUs)),
    rating: sum(orders.filter((o) => o.ratingOrder)),
    returnedBags: real.filter((o) => o.returned).length,
  }
}

/** "MISSED_TRAIN" → "Missed train"; "Not delivered: Passenger …" → "Passenger …". */
export function readableReason(raw: string | null): string {
  const r = (raw ?? '').replace(/^(?:not delivered|cancelled on the way):\s*/i, '').trim()
  if (!r) return 'No reason given'
  if (/^[A-Z0-9_]+$/.test(r)) {
    const words = r.toLowerCase().replace(/_+/g, ' ').trim()
    return words.charAt(0).toUpperCase() + words.slice(1)
  }
  return r
}

/* ── riders ─────────────────────────────────────────────────────────────── */

export type RiderStat = { riderId: string; delivered: number; notDelivered: number; rate: number; avgMinutes: number | null }

export function riderStats(orders: ReportOrder[]): RiderStat[] {
  const map = new Map<string, { d: number; f: number; mins: number[] }>()
  for (const o of orders) {
    if (o.ratingOrder || !o.riderId) continue
    if (o.status !== 'DELIVERED' && o.status !== 'FAILED') continue
    const r = map.get(o.riderId) ?? { d: 0, f: 0, mins: [] }
    if (o.status === 'DELIVERED') {
      r.d += 1
      if (o.dispatchedAt && o.deliveredAt) {
        const m = (o.deliveredAt.getTime() - o.dispatchedAt.getTime()) / 60_000
        if (m > 0 && m < 600) r.mins.push(m)
      }
    } else r.f += 1
    map.set(o.riderId, r)
  }
  return [...map.entries()]
    .map(([riderId, r]) => ({
      riderId,
      delivered: r.d,
      notDelivered: r.f,
      rate: r.d + r.f ? Math.round((r.f / (r.d + r.f)) * 100) : 0,
      avgMinutes: r.mins.length ? Math.round(r.mins.reduce((a, b) => a + b, 0) / r.mins.length) : null,
    }))
    .sort((a, b) => b.delivered - a.delivered)
}

/* ── passengers ─────────────────────────────────────────────────────────── */

/** How many passengers came back: ordered before this period, or more than once in it. */
export function returning(orders: ReportOrder[], seenBefore: Set<string>): { passengers: number; returning: number; share: number } {
  const counts = new Map<string, number>()
  for (const o of orders) {
    if (!isSale(o) || !o.phone) continue
    const p = o.phone.replace(/\D/g, '').slice(-10)
    if (p.length < 10) continue
    counts.set(p, (counts.get(p) ?? 0) + 1)
  }
  const seen = new Set([...seenBefore].map((p) => p.replace(/\D/g, '').slice(-10)))
  const back = [...counts.entries()].filter(([p, n]) => n > 1 || seen.has(p)).length
  return { passengers: counts.size, returning: back, share: counts.size ? Math.round((back / counts.size) * 100) : 0 }
}
