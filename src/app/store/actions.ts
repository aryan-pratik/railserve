'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/session'
import { findById } from '@/lib/repo/orderRepo'
import { transitionOrder } from '@/lib/repo/transitionOrder'
import { transitionRun, type RunActionResult } from '@/lib/repo/runRepo'
import { NotFoundError } from '@/lib/authContext'
import { timingForOrders, timingFor } from '@/lib/train/service'
import { env } from '@/lib/env'
import { shouldWarnAboutDelay } from '@/lib/train/policy'

/**
 * Plan §9 delay guard: before printing a KOT, check live status. If the train
 * is late beyond the threshold, the manager is asked to confirm rather than
 * blocked — the system does not know whether the kitchen wants to start now.
 * This is the one place fire-and-forget cooking gets a safety net.
 */
export async function checkKotDelay(orderId: string): Promise<{
  delayed: boolean
  delayMinutes: number | null
  trainNo: string | null
  expected: string | null
  thresholdMinutes: number
}> {
  const ctx = await requireRole('STORE_MANAGER', 'ADMIN')
  const order = await findById(ctx, orderId)
  if (!order) throw new NotFoundError('Order not found')

  const threshold = env.KOT_DELAY_THRESHOLD_MINUTES

  if (!order.trainNo) {
    return { delayed: false, delayMinutes: null, trainNo: null, expected: null, thresholdMinutes: threshold }
  }

  const timings = await timingForOrders([order])
  const t = timingFor(order, timings)

  return {
    delayed: shouldWarnAboutDelay(t.delayMinutes, threshold),
    delayMinutes: t.delayMinutes,
    trainNo: order.trainNo,
    expected: t.effectiveArrival ? t.effectiveArrival.toISOString() : null,
    thresholdMinutes: threshold,
  }
}

export type StoreActionState = { error?: string; ok?: string }

export async function acceptOrder(
  _prev: StoreActionState,
  formData: FormData,
): Promise<StoreActionState> {
  const ctx = await requireRole('STORE_MANAGER', 'ADMIN')
  const orderId = String(formData.get('orderId') ?? '')

  try {
    await transitionOrder({ ctx, orderId, to: 'ACCEPTED', meta: { via: 'store-dashboard' } })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not accept the order.' }
  }

  revalidatePath('/store')
  revalidatePath(`/store/orders/${orderId}`)
  return { ok: 'Accepted.' }
}

export async function markPrepared(
  _prev: StoreActionState,
  formData: FormData,
): Promise<StoreActionState> {
  const ctx = await requireRole('STORE_MANAGER', 'ADMIN')
  const orderId = String(formData.get('orderId') ?? '')

  try {
    await transitionOrder({ ctx, orderId, to: 'PREPARED', meta: { via: 'store-dashboard' } })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not mark prepared.' }
  }

  revalidatePath('/store')
  revalidatePath(`/store/orders/${orderId}`)
  revalidatePath('/agent')
  return { ok: 'Marked prepared.' }
}

/**
 * Generate KOT: moves ACCEPTED -> KOT_PRINTED and opens the print view.
 *
 * Reprinting is deliberately not an error. A thermal printer jams, paper runs
 * out, a docket gets lost on the pass — the manager will hit this again, and
 * refusing on the grounds that the status already moved would be useless
 * pedantry. The transition happens once; the view is reachable forever after.
 */
export async function generateKot(formData: FormData) {
  const ctx = await requireRole('STORE_MANAGER', 'ADMIN')
  const orderId = String(formData.get('orderId') ?? '')

  const order = await findById(ctx, orderId)
  if (!order) throw new NotFoundError('Order not found')

  if (order.status === 'ACCEPTED') {
    await transitionOrder({ ctx, orderId, to: 'KOT_PRINTED', meta: { via: 'store-dashboard' } })
    revalidatePath('/store')
    revalidatePath(`/store/orders/${orderId}`)
  }

  redirect(`/store/orders/${orderId}/kot`)
}

/* ── whole-train actions ──────────────────────────────────────────────────────
 * The board groups by train because one rider carries one train's orders in one
 * trip. These let a manager move that whole group without clicking through it
 * order by order, which on a five-order train is the difference between one
 * action and fifteen.
 */

function summarise(result: RunActionResult, verb: string): StoreActionState {
  if (result.errors.length > 0) return { error: result.errors[0] }
  if (result.moved === 0) return { error: `Nothing to ${verb}.` }
  return { ok: `${result.moved} order${result.moved === 1 ? '' : 's'} ${verb}.` }
}

export async function acceptRun(
  _prev: StoreActionState,
  formData: FormData,
): Promise<StoreActionState> {
  const ctx = await requireRole('STORE_MANAGER', 'ADMIN')
  const runKey = String(formData.get('runKey') ?? '')

  const result = await transitionRun(ctx, runKey, 'RECEIVED', 'ACCEPTED', { via: 'store-board' })
  revalidatePath('/store')
  return summarise(result, 'accepted')
}

export async function markRunPrepared(
  _prev: StoreActionState,
  formData: FormData,
): Promise<StoreActionState> {
  const ctx = await requireRole('STORE_MANAGER', 'ADMIN')
  const runKey = String(formData.get('runKey') ?? '')

  const result = await transitionRun(ctx, runKey, 'KOT_PRINTED', 'PREPARED', { via: 'store-board' })
  revalidatePath('/store')
  revalidatePath('/agent')
  return summarise(result, 'ready')
}

/**
 * Prints one ticket per order for the whole train, as a single print job.
 *
 * The chef wants a ticket per order — one bag, one docket — but the manager
 * should not have to open five pages to get five tickets. The print view
 * renders them stacked with a page break between, so the printer cuts between
 * dockets on its own.
 */
export async function generateRunKot(formData: FormData) {
  const ctx = await requireRole('STORE_MANAGER', 'ADMIN')
  const runKey = String(formData.get('runKey') ?? '')

  await transitionRun(ctx, runKey, 'ACCEPTED', 'KOT_PRINTED', { via: 'store-board' })
  revalidatePath('/store')

  redirect(`/store/runs/${encodeURIComponent(runKey)}/kot`)
}
