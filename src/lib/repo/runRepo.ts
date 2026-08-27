import { findMany } from './orderRepo'
import { assignAgents, transitionOrder } from './transitionOrder'
import { ForbiddenError, type AuthContext } from '../authContext'
import { groupIntoRuns, parseRunKey, type Run } from '../runs'
import type { OrderStatus } from '../orderStatus'

/** Statuses that still belong on an operational run view. */
const LIVE_STATUSES: OrderStatus[] = [
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
 * Dispatch the whole run. Plan §9: the unit of dispatch is the run, not the
 * order — the agent picks up everything for that train in one go.
 *
 * Each order still goes through transitionOrder individually, so every one gets
 * its own transaction, precondition check and event. Orders that are not yet
 * PREPARED are skipped rather than failing the batch: a run where four of five
 * are ready should still leave, and the kitchen finishing late is not the
 * agent's error to resolve at the platform.
 */
export async function dispatchRun(
  ctx: AuthContext,
  runKey: string,
): Promise<RunActionResult> {
  if (ctx.role !== 'DELIVERY_AGENT') {
    throw new ForbiddenError('Only a delivery agent may dispatch a run')
  }

  const run = await findRun(ctx, runKey)
  if (!run) return { moved: 0, skipped: 0, errors: ['Run not found'] }

  const result: RunActionResult = { moved: 0, skipped: 0, errors: [] }

  for (const order of run.orders) {
    if (order.status !== 'PREPARED') {
      result.skipped += 1
      continue
    }
    try {
      await transitionOrder({
        ctx,
        orderId: String(order._id),
        to: 'DISPATCHED',
        meta: { via: 'agent-run', runKey },
      })
      result.moved += 1
    } catch (err) {
      result.errors.push(
        `${order.externalOrderId}: ${err instanceof Error ? err.message : 'failed'}`,
      )
    }
  }

  return result
}

/** Assigns the same agents to every order on a run. Admin only. */
export async function assignRun(
  ctx: AuthContext,
  runKey: string,
  agentIds: string[],
): Promise<RunActionResult> {
  if (ctx.role !== 'ADMIN') {
    throw new ForbiddenError('Only an admin may assign a run')
  }

  const run = await findRun(ctx, runKey)
  if (!run) return { moved: 0, skipped: 0, errors: ['Run not found'] }

  const result: RunActionResult = { moved: 0, skipped: 0, errors: [] }

  for (const order of run.orders) {
    try {
      await assignAgents({ ctx, orderId: String(order._id), agentIds })
      result.moved += 1
    } catch (err) {
      result.errors.push(
        `${order.externalOrderId}: ${err instanceof Error ? err.message : 'failed'}`,
      )
    }
  }

  return result
}
