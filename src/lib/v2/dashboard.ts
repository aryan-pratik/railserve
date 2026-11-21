import { cache } from 'react'
import type { AuthContext } from '@/lib/authContext'
import { loadRunBoard, type RunBoard } from '@/lib/board'
import { ORDER_STATUSES } from '@/lib/orderStatus'
import { LIVE_STATUSES } from '@/lib/repo/runRepo'
import { computeDispatchAt } from '@/lib/train/policy'
import { env } from '@/lib/env'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'
import { runTrainLabel } from '@/lib/runs'

/**
 * What the v2 dashboard and its shell both read: today's runs with live
 * timing, plus the outlets. Wrapped in React's `cache` so the layout (which
 * draws the next-arrival tile) and the page (which draws everything else)
 * share one read per request instead of hitting Mongo twice.
 *
 * Cache-only timing (`allowFetch: false`): the train-poll cron keeps the rows
 * warm, and a dashboard that every admin leaves open all day must not spend
 * provider quota on its own.
 */
export const loadToday = cache(async (ctx: AuthContext) => {
  await connectDb()
  const [board, outlets] = await Promise.all([
    loadRunBoard(ctx, 'today', { allowFetch: false, statuses: [...ORDER_STATUSES] }),
    Restaurant.find({ tenantId: ctx.tenantId }).select('name walkToPlatformMinutes stationCode').lean(),
  ])
  const outletById = new Map(
    outlets.map((o) => [String(o._id), { name: o.name, walk: o.walkToPlatformMinutes ?? 10, stationCode: o.stationCode }]),
  )
  return { board, outletById }
})

/** The same read for one chosen service day: history or a plan, every status. */
export const loadDay = cache(async (ctx: AuthContext, date: string) => {
  await connectDb()
  const [board, outlets] = await Promise.all([
    loadRunBoard(ctx, 'date', { date, allowFetch: false }),
    Restaurant.find({ tenantId: ctx.tenantId }).select('name walkToPlatformMinutes stationCode').lean(),
  ])
  const outletById = new Map(
    outlets.map((o) => [String(o._id), { name: o.name, walk: o.walkToPlatformMinutes ?? 10, stationCode: o.stationCode }]),
  )
  return { board, outletById }
})

export type NextArrival = {
  runKey: string
  trainLabel: string
  trainName: string | null
  stationCode: string
  platform: string | null
  etaIso: string | null
  arrived: boolean
  /** When the first bag has to leave the kitchen, worked back from the ETA. */
  leaveByIso: string | null
  walkMinutes: number
  counts: { total: number; ready: number; cooking: number; fresh: number; out: number }
}

const LIVE = new Set<string>(LIVE_STATUSES)

/**
 * The train the kitchen should be thinking about: the soonest still-arriving
 * run with something open on it. Falls back to the soonest run with anything
 * out for delivery, so the tile still points at the platform after arrival.
 */
export function nextArrival(
  board: RunBoard,
  outletById: Map<string, { name: string; walk: number }>,
): NextArrival | null {
  const describe = (run: RunBoard['runs'][number]): NextArrival => {
    const t = board.timingOf(run)
    const live = run.orders.filter((o) => LIVE.has(o.status))
    const walk = Math.max(
      ...run.orders.map((o) => outletById.get(String(o.restaurantId))?.walk ?? 10),
      0,
    )
    const leaveBy = computeDispatchAt({
      etaAt: t.effectiveArrival,
      walkToPlatformMinutes: walk || 10,
      bufferMinutes: env.DISPATCH_BUFFER_MINUTES,
    })
    return {
      runKey: run.key,
      trainLabel: runTrainLabel(run),
      trainName: run.trainName,
      stationCode: run.stationCode,
      platform: t.platform,
      etaIso: t.effectiveArrival?.toISOString() ?? null,
      arrived: t.arrived,
      leaveByIso: leaveBy?.toISOString() ?? null,
      walkMinutes: walk || 10,
      counts: {
        total: live.length,
        ready: live.filter((o) => o.status === 'PREPARED').length,
        cooking: live.filter((o) => o.status === 'ACCEPTED' || o.status === 'KOT_PRINTED').length,
        fresh: live.filter((o) => o.status === 'RECEIVED').length,
        out: live.filter((o) => o.status === 'DISPATCHED').length,
      },
    }
  }

  // Runs come urgency-sorted: still arriving first, soonest first.
  const stillComing = board.runs.find((run) => {
    const t = board.timingOf(run)
    return !t.arrived && t.effectiveArrival && run.orders.some((o) => LIVE.has(o.status) && o.status !== 'DISPATCHED')
  })
  if (stillComing) return describe(stillComing)
  const anythingOpen = board.runs.find((run) => run.orders.some((o) => LIVE.has(o.status)))
  return anythingOpen ? describe(anythingOpen) : null
}
