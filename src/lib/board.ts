import type { QueryFilter } from 'mongoose'
import { connectDb } from './db'
import { Restaurant } from './models'
import type { AuthContext } from './authContext'
import { findRuns, findUpcomingRuns, LIVE_STATUSES } from './repo/runRepo'
import { countOrders } from './repo/orderRepo'
import { timingForOrders, timingFor, trainFeedHealth, type TrainFeedHealth } from './train/service'
import type { TimingView } from './train/policy'
import { sortRunsByUrgency, type Run } from './runs'
import { shiftServiceDate, todayIST } from './format'
import { ORDER_STATUSES } from './orderStatus'
import { liveServiceDates } from './liveDay'

/**
 * What is open right now: every open order on a live service date.
 *
 * The one place the store board, the call board and the admin count agree on
 * what "today" means, including the past-midnight window.
 */
export function liveFilter(now: Date = new Date()): QueryFilter<Record<string, unknown>> {
  return { serviceDate: { $in: liveServiceDates(now) }, status: { $in: LIVE_STATUSES } }
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
  opts: { allowFetch?: boolean } = {},
): Promise<RunBoard> {
  const now = new Date()
  const today = todayIST(now)
  const multiOutlet = ctx.restaurantIds.length > 1

  await connectDb()
  const [found, feedHealth, outlets] = await Promise.all([
    mode === 'upcoming'
      ? findUpcomingRuns(ctx, today)
      : mode === 'yesterday'
        ? // Every status: this view is for looking back at the whole of last
          // night as well as finishing what is left of it.
          findRuns(ctx, shiftServiceDate(today, -1), { statuses: [...ORDER_STATUSES] })
        : findRuns(ctx, liveServiceDates(now)),
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
