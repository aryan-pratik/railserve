import { findMany } from './orderRepo'
import { transitionOrder } from './transitionOrder'
import { ForbiddenError, type AuthContext } from '../authContext'
import { groupIntoRuns, parseRunKey, type Run } from '../runs'
import type { OrderStatus } from '../orderStatus'

/** Statuses that still belong on an operational run view. */
export const LIVE_STATUSES: OrderStatus[] = [
  'RECEIVED', 'ACCEPTED', 'KOT_PRINTED', 'PREPARED', 'DISPATCHED',
]

type RunOrderDoc = Awaited<ReturnType<typeof findMany>>[number]

/** Runs for a service date, within the caller's scope. */
export async function findRuns(
  ctx: AuthContext,
  serviceDate: string,
  opts: { statuses?: OrderStatus[] } = {},
): Promise<Run<RunOrderDoc>[]> {
  const orders = await findMany(
    ctx,
    { serviceDate, status: { $in: opts.statuses ?? LIVE_STATUSES } },
    { sort: { createdAt: 1 }, limit: 500 },
  )
  return groupIntoRuns(orders)
}

/**
 * Runs booked for a later date.
 *
 * Bulk orders are placed days ahead, and they must not clutter the screen a
 * kitchen works from today — but they also must not be invisible until the
 * morning they are due.
 */
export async function findUpcomingRuns(
  ctx: AuthContext,
  afterServiceDate: string,
  opts: { statuses?: OrderStatus[] } = {},
): Promise<Run<RunOrderDoc>[]> {
  const orders = await findMany(
    ctx,
    {
      serviceDate: { $gt: afterServiceDate },
      status: { $in: opts.statuses ?? LIVE_STATUSES },
    },
    { sort: { serviceDate: 1, createdAt: 1 }, limit: 500 },
  )
  return groupIntoRuns(orders)
}

export async function findRun(
  ctx: AuthContext,
  runKey: string,
  opts: { statuses?: OrderStatus[] } = {},
): Promise<Run<RunOrderDoc> | null> {
  const identity = parseRunKey(runKey)
  if (!identity) return null

  const runs = await findRuns(ctx, identity.serviceDate, opts)
  return runs.find((r) => r.key === runKey) ?? null
}

export type RunActionResult = { moved: number; skipped: number; errors: string[] }

/**
 * Moves every order on a run that is sitting in `from` into `to`.
 *
 * The run is the unit of work — one rider takes one train — so the whole run
 * advances with one click. Each order still goes through transitionOrder
 * individually, so every one gets its own transaction, precondition check and
 * event; nothing here bypasses the status machine.
 *
 * Orders not in `from` are skipped rather than failing the batch. A run where
 * four of five are ready should still move, and the fifth arriving late is not
 * a reason to refuse the other four.
 */
export async function transitionRun(
  ctx: AuthContext,
  runKey: string,
  from: OrderStatus,
  to: OrderStatus,
  meta: Record<string, unknown> = {},
): Promise<RunActionResult> {
  const run = await findRun(ctx, runKey)
  if (!run) return { moved: 0, skipped: 0, errors: ['Run not found'] }

  const result: RunActionResult = { moved: 0, skipped: 0, errors: [] }

  for (const order of run.orders) {
    if (order.status !== from) {
      result.skipped += 1
      continue
    }
    try {
      await transitionOrder({ ctx, orderId: String(order._id), to, meta: { ...meta, runKey } })
      result.moved += 1
    } catch (err) {
      result.errors.push(
        `${order.externalOrderId}: ${err instanceof Error ? err.message : 'failed'}`,
      )
    }
  }

  return result
}

/**
 * Dispatch the whole run. Plan §9: the unit of dispatch is the run, not the
 * order — the agent picks up everything for that train in one go.
 */
export async function dispatchRun(
  ctx: AuthContext,
  runKey: string,
): Promise<RunActionResult> {
  if (ctx.role !== 'DELIVERY_AGENT') {
    throw new ForbiddenError('Only a delivery agent may dispatch a run')
  }
  return transitionRun(ctx, runKey, 'PREPARED', 'DISPATCHED', { via: 'agent-run' })
}
