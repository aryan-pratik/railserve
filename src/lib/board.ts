import type { QueryFilter } from 'mongoose'
import { connectDb } from './db'
import { Restaurant } from './models'
import type { AuthContext } from './authContext'
import { findRuns, findRunsWhere, findUpcomingRuns, LIVE_STATUSES } from './repo/runRepo'
import { countOrders } from './repo/orderRepo'
import { timingForOrders, timingFor, trainFeedHealth, type TrainFeedHealth } from './train/service'
import type { TimingView } from './train/policy'
import { sortRunsByUrgency, type Run } from './runs'
import { shiftServiceDate, todayIST } from './format'
import { ORDER_STATUSES, type OrderStatus } from './orderStatus'
import { inRollover, rolloverCutoff } from './liveDay'

type OrderFilter = QueryFilter<Record<string, unknown>>

/**
 * Last night's orders that still belong on Today: open, and on a train booked
 * to arrive no earlier than the cutoff (see ROLLOVER_ARRIVAL_GRACE_HOURS).
 * Only meaningful inside the past-midnight window.
 */
function carriedOver(now: Date, statuses: readonly string[]): OrderFilter | null {
  const open = statuses.filter((s) => (LIVE_STATUSES as string[]).includes(s))
  if (!inRollover(now) || open.length === 0) return null
  return {
    serviceDate: shiftServiceDate(todayIST(now), -1),
    status: { $in: open },
    scheduledArrival: { $gte: rolloverCutoff(now) },
  }
}

/**
 * The orders on Today, for the given statuses (the open ones by default).
 *
 * Today's service date, plus — past midnight — last night's orders that are
 * still open on a train that is due or only just gone. A finished order from
 * last night is never carried over, whichever statuses are asked for: it is
 * history, and lives under Yesterday.
 *
 * The one place the store board, the call board and the admin count agree on
 * what "today" means.
 */
export function todayBoardFilter(
  now: Date = new Date(),
  statuses: readonly string[] = LIVE_STATUSES,
): OrderFilter {
  const own: OrderFilter = { serviceDate: todayIST(now), status: { $in: [...statuses] } }
  const carried = carriedOver(now, statuses)
  return carried ? { $or: [own, carried] } : own
}

/**
 * The orders on Yesterday: last night's service date, minus whatever Today is
 * still showing during the window, so no order is ever listed on both.
 */
export function yesterdayBoardFilter(
  now: Date = new Date(),
  statuses: readonly string[] = ORDER_STATUSES,
): OrderFilter {
  const own: OrderFilter = { serviceDate: shiftServiceDate(todayIST(now), -1), status: { $in: [...statuses] } }
  const carried = carriedOver(now, LIVE_STATUSES)
  return carried ? { ...own, $nor: [carried] } : own
}

/** What is open right now on Today. */
export function liveFilter(now: Date = new Date()): OrderFilter {
  return todayBoardFilter(now)
}

/** How many open orders are on the live board, within the caller's scope. */
export function countLive(ctx: AuthContext, now: Date = new Date()) {
  return countOrders(ctx, liveFilter(now))
}

export type BoardMode = 'today' | 'yesterday' | 'upcoming'

type BoardRun = Run<Awaited<ReturnType<typeof findRuns>>[number]['orders'][number]>

export type RunBoard = {
  /** Urgency order: soonest real arrival first, unknown last. */
  runs: BoardRun[]
  timings: Map<string, TimingView>
  /** Live timing for one run: every order on it shares the train's reading. */
  timingOf: (run: BoardRun) => TimingView
  feedHealth: TrainFeedHealth
  /** Outlet names by id; empty unless the viewer holds more than one outlet. */
  outletName: Map<string, string>
  multiOutlet: boolean
  /** When this snapshot was read, for the "updated" stamp. */
  loadedAt: Date
}

/**
 * The train-run board, as the kitchen and the call desk both see it.
 *
 * Runs are ordered by when the train will actually arrive, from the same
 * timing reads the store board uses, so a delay moves a train on every screen
 * at once. Callers shape the rows for their own audience; the timing, the
 * ordering and the scope are decided here and nowhere else.
 *
 * `allowFetch` defaults to the kitchen's behaviour; see the timing read below.
 */
export async function loadRunBoard(
  ctx: AuthContext,
  mode: BoardMode,
  opts: { allowFetch?: boolean; statuses?: OrderStatus[]; now?: Date } = {},
): Promise<RunBoard> {
  const now = opts.now ?? new Date()
  const today = todayIST(now)
  const multiOutlet = ctx.restaurantIds.length > 1

  await connectDb()
  const [found, feedHealth, outlets] = await Promise.all([
    mode === 'upcoming'
      ? findUpcomingRuns(ctx, today, { statuses: opts.statuses })
      : mode === 'yesterday'
        ? // Every status: this view is for looking back at the whole of last
          // night as well as finishing what is left of it.
          findRunsWhere(ctx, yesterdayBoardFilter(now, opts.statuses))
        : findRunsWhere(ctx, todayBoardFilter(now, opts.statuses)),
    trainFeedHealth(),
    // Outlet names only matter to someone who holds more than one.
    multiOutlet
      ? Restaurant.find({ _id: { $in: ctx.restaurantIds } }).select('name').lean()
      : Promise.resolve([]),
  ])

  // `allowFetch: false` reads the cache only. The kitchen board may go to the
  // provider for a train nobody has looked at; a desk that only reads must not,
  // or every open telecaller screen spends a metered quota. The train-poll cron
  // keeps the cache warm, and both screens read the same rows from it.
  const timings = await timingForOrders(
    found.flatMap((r) => r.orders),
    { allowFetch: opts.allowFetch },
  )
  const timingOf = (run: BoardRun) => timingFor(run.orders[0], timings)

  return {
    runs: sortRunsByUrgency(found, (r) => timingOf(r).effectiveArrival),
    timings,
    timingOf,
    feedHealth,
    outletName: new Map(outlets.map((o) => [String(o._id), o.name])),
    multiOutlet,
    loadedAt: now,
  }
}
