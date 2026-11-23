import type { Role } from '@/lib/roles'
import type { DateFilterMode } from '@/lib/dateFilter'
import { todayIST } from '@/lib/format'
import { todayBoardFilter } from '@/lib/board'
import { ORDER_STATUSES } from '@/lib/orderStatus'
import { NOT_DECOY } from '@/lib/analytics'

/*
 * The saved views of the v2 Orders table, and the pure helpers its page and
 * its row components share. No database reads here: the page runs the
 * queries through src/lib/repo, these only decide what the queries say.
 */

export const ORDER_VIEWS = ['today', 'upcoming', 'enquiries', 'returns', 'cancelled', 'all'] as const
export type OrderView = (typeof ORDER_VIEWS)[number]

export const VIEW_LABEL: Record<OrderView, string> = {
  today: 'Today',
  upcoming: 'Upcoming',
  enquiries: 'Enquiries',
  returns: 'Returns',
  cancelled: 'Cancelled',
  all: 'All',
}

export const ENQUIRY_STATUSES = ['ENQUIRY', 'QUOTED', 'LOST'] as const
export const CANCELLED_STATUSES = ['FAILED', 'CANCELLED'] as const

/** Group-booking stages live on Group bookings only, never in the order lists. */
const NOT_GROUP_STAGE = { status: { $nin: [...ENQUIRY_STATUSES] } }
const ORDER_LIST_STATUSES = ORDER_STATUSES.filter((s) => !(ENQUIRY_STATUSES as readonly string[]).includes(s))

export function readView(raw: string | string[] | undefined): OrderView {
  const v = Array.isArray(raw) ? raw[0] : raw
  return (ORDER_VIEWS as readonly string[]).includes(v ?? '') ? (v as OrderView) : 'today'
}

/** Enquiries never reach a kitchen until confirmed, so only an admin has a list to look at. */
export function viewsFor(role: Role): OrderView[] {
  return ORDER_VIEWS.filter((v) => v !== 'enquiries' || role === 'ADMIN')
}

/** Whether the date chips apply on this view. Today and Upcoming are dates already. */
export function viewHasDates(view: OrderView): boolean {
  return view === 'all' || view === 'cancelled' || view === 'returns' || view === 'enquiries'
}

/**
 * The dates a view opens on. All opens on today like every dated screen; the
 * others are rare enough that a day window would only be one more click to
 * widen. Returns open on all time for everyone: a bag is still out until it
 * is back on the counter, whatever day it left, and the tab's badge counts
 * every pending one, so the list under it must too.
 */
export function defaultDateMode(view: OrderView): DateFilterMode {
  if (view === 'all') return 'today'
  return 'all'
}

type Clause = Record<string, unknown>

/**
 * What each view lists before the person's own filters are layered on.
 * Rating decoys stay out unless the status filter names them, the same rule
 * as the filter bar's own clause (orderFilterClause), so the two agree.
 */
export function viewClause(view: OrderView, now: Date = new Date()): Clause {
  const today = todayIST(now)
  switch (view) {
    case 'today':
      // Every status today, plus last night's open orders on a train still
      // due: the kitchen's own rule, so this board never disagrees with it.
      return { $and: [todayBoardFilter(now, ORDER_LIST_STATUSES), NOT_DECOY] }
    case 'upcoming':
      return { serviceDate: { $gt: today }, ...NOT_DECOY, ...NOT_GROUP_STAGE }
    case 'enquiries':
      return { status: { $in: [...ENQUIRY_STATUSES] } }
    case 'cancelled':
      return { status: { $in: [...CANCELLED_STATUSES] } }
    case 'returns':
      // listReturns adds the RTO condition itself.
      return {}
    case 'all':
      return NOT_GROUP_STAGE
  }
}

export type SortKey = 'eta' | 'newest'

export function readSort(raw: string | string[] | undefined, view: OrderView): SortKey {
  const v = Array.isArray(raw) ? raw[0] : raw
  if (v === 'eta' || v === 'newest') return v
  return view === 'today' || view === 'upcoming' ? 'eta' : 'newest'
}

/** The Mongo sort behind a flat page. ETA order is by the booked arrival; the live reading colours the row. */
export function mongoSort(sort: SortKey): Record<string, 1 | -1> {
  return sort === 'eta'
    ? { serviceDate: 1, scheduledArrival: 1, createdAt: 1, _id: 1 }
    : { createdAt: -1, _id: -1 }
}

export { isLive, runCounts, maskPhone, BULK_ACTIONS, bulkPick, parseBulkPick } from './ordersShared'
export type { BulkKind } from './ordersShared'
