import type { AuthContext } from '@/lib/authContext'
import { Restaurant, Station } from '@/lib/models'
import { ORDER_STATUSES } from '@/lib/orderStatus'
import { ORDER_TYPES } from '@/lib/orderEnums'
import { resolveDateRange, type DateFilterMode } from '@/lib/dateFilter'
import { distinctStatuses } from './orderRepo'
import { andClause, riderClause, riderOptions, type RiderOption } from './riderFilter'
import { orderSearchClause, parseStations } from './orderSearch'

/**
 * The order filter bar, shared by every screen that lists orders through it:
 * the admin All orders lookup and the Returns page. One parser, one query
 * builder and one set of dropdown options, so the same URL means the same
 * thing on each.
 */

type Params = Record<string, string | string[] | undefined>

export type OrderFilters = {
  q: string
  train: string
  stations: string[]
  outlet: string
  status: string
  type: string
  rider: string
  mode: DateFilterMode
  month: string
  from: string
  to: string
  /** The date mode this screen opens on, so it does not count as a filter. */
  defaultMode: DateFilterMode
  /** Whether the URL picked a date mode, rather than the default applying. */
  modeSet: boolean
}

/**
 * The date mode that applies when none is picked. A search looks across all
 * time: an order is searched for because it is not on today's list, and
 * finding nothing for one placed yesterday read as the search being broken.
 */
function impliedMode(q: string, defaultMode: DateFilterMode): DateFilterMode {
  return q ? 'all' : defaultMode
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''
const many = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : [])

/** Reads the filter bar's fields from a page's search params. */
export function readOrderFilters(sp: Params, opts: { defaultMode: DateFilterMode }): OrderFilters {
  const rawType = one(sp.type)
  const rawRider = one(sp.rider)
  // `orderId` is what the search box used to be called, so links
  // bookmarked before then still find their order.
  const q = (one(sp.q) || one(sp.orderId)).trim()
  const rawMode = one(sp.mode)
  return {
    q,
    train: one(sp.train).trim(),
    stations: parseStations(many(sp.station)),
    outlet: one(sp.outlet),
    status: one(sp.status),
    // Unknown values are dropped, so a stale link cannot filter to nothing.
    type: (ORDER_TYPES as readonly string[]).includes(rawType) ? rawType : '',
    // Dropped when it is neither an id nor NO_RIDER, so links never carry junk.
    rider: riderClause(rawRider) ? rawRider : '',
    mode: (rawMode || impliedMode(q, opts.defaultMode)) as DateFilterMode,
    month: one(sp.month),
    from: one(sp.from),
    to: one(sp.to),
    defaultMode: opts.defaultMode,
    modeSet: Boolean(rawMode),
  }
}

/** Whether anything beyond the screen's own defaults is set. */
export function hasOrderFilters(f: OrderFilters): boolean {
  return Boolean(
    f.outlet || f.stations.length || f.status || f.mode !== f.defaultMode || f.train || f.type || f.q || f.rider,
  )
}

/**
 * The filters as query params, for links that must carry them: tabs, the
 * pager, the export. The date mode is only written when it differs from
 * what the screen would apply on its own, so a search left on the default
 * keeps searching all time and drops back to the default once cleared.
 */
export function orderFilterParams(f: OrderFilters): URLSearchParams {
  const u = new URLSearchParams()
  const pairs: [string, string][] = [
    ['outlet', f.outlet],
    ['status', f.status],
    ['mode', f.mode !== impliedMode(f.q, f.defaultMode) ? f.mode : ''],
    ['month', f.month],
    ['from', f.from],
    ['to', f.to],
    ['train', f.train],
    ['type', f.type],
    ['q', f.q],
    ['rider', f.rider],
  ]
  for (const [k, v] of pairs) if (v) u.set(k, v)
  for (const s of f.stations) u.append('station', s)
  return u
}

/**
 * The Mongo clause for the filters, layered on top of the caller's scope by
 * whoever runs the query, never instead of it. Dates read `serviceDate`,
 * the day the order is for, on every screen.
 */
export async function orderFilterClause(f: OrderFilters): Promise<Record<string, unknown>> {
  const clause: Record<string, unknown> = {}
  if (f.outlet) clause.restaurantId = f.outlet
  if (f.stations.length) clause.stationCode = { $in: f.stations }
  if (f.status) clause.status = f.status
  const { from, to } = resolveDateRange(f.mode, { month: f.month, from: f.from, to: f.to })
  if (from || to) {
    const range: Record<string, string> = {}
    if (from) range.$gte = from
    if (to) range.$lte = to
    clause.serviceDate = range
  }
  if (f.train) clause.trainNo = f.train.toUpperCase()
  if (f.type) clause.orderType = f.type
  const byRider = riderClause(f.rider)
  andClause(clause, byRider)
  const search = await orderSearchClause(f.q)
  andClause(clause, search)
  return clause
}

export type OrderFilterOptions = {
  outlets: { id: string; name: string; stationCode: string }[]
  stations: { code: string; name: string | null }[]
  statuses: string[]
  riders: RiderOption[]
}

/**
 * What the dropdowns offer, within the caller's reach: an admin sees every
 * outlet, anyone else the outlets they hold. Stations already picked stay
 * listed, so a selection never silently drops out.
 */
export async function orderFilterOptions(ctx: AuthContext, picked: string[] = []): Promise<OrderFilterOptions> {
  const outletFilter = ctx.role === 'ADMIN' ? {} : { _id: { $in: ctx.restaurantIds } }
  const [outlets, stationDocs, statusesInUse, riders] = await Promise.all([
    Restaurant.find(outletFilter).select('name stationCode stationName').sort({ name: 1 }).lean(),
    Station.find({}).select('name').lean(),
    distinctStatuses(ctx),
    riderOptions(ctx),
  ])

  // Custom statuses an admin has typed in stay selectable once they exist.
  const customStatuses = statusesInUse
    .filter((s) => !(ORDER_STATUSES as readonly string[]).includes(s))
    .sort()

  // Named from the station record, falling back to whatever an outlet calls it.
  const stationName = new Map<string, string>()
  for (const o of outlets) if (o.stationName && !stationName.has(o.stationCode)) stationName.set(o.stationCode, o.stationName)
  for (const s of stationDocs) if (s.name) stationName.set(String(s._id), s.name)

  return {
    outlets: outlets.map((o) => ({ id: String(o._id), name: o.name, stationCode: o.stationCode })),
    stations: [...new Set([...outlets.map((o) => o.stationCode), ...picked])]
      .sort()
      .map((code) => ({ code, name: stationName.get(code) ?? null })),
    statuses: [...ORDER_STATUSES, ...customStatuses],
    riders,
  }
}
