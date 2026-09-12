'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/session'
import { findById } from '@/lib/repo/orderRepo'
import { transitionOrder } from '@/lib/repo/transitionOrder'
import { findRun, transitionRun, handRunToRider, type RunActionResult } from '@/lib/repo/runRepo'
import { NotFoundError } from '@/lib/authContext'
import { timingForOrders, timingFor, forceRefreshTrainStatus } from '@/lib/train/service'
import { env } from '@/lib/env'
import { shouldWarnAboutDelay } from '@/lib/train/policy'
import type { RefreshTrainState } from '@/components/RefreshTrainButton'
import {
  enqueueOrderKotPrint,
  enqueueRunKotPrint,
  getAppOrigin,
  assertPrintAgentConfigured,
} from '@/lib/printer/queue'

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

/**
 * "Check now" for the train behind one order — see RefreshTrainButton. Any
 * order riding the same train shares this cache row, so one click updates
 * the whole board's view of it, not just this order's.
 */
export async function forceRefreshOrderTrain(
  _prev: RefreshTrainState,
  formData: FormData,
): Promise<RefreshTrainState> {
  const ctx = await requireRole('STORE_MANAGER', 'ADMIN')
  const orderId = String(formData.get('orderId') ?? '')
  const order = await findById(ctx, orderId)
  if (!order) return { error: 'Order not found' }

  const row = await forceRefreshTrainStatus(order)
  revalidatePath('/store')
  if (!row) return { error: 'This order has no train.' }
  if (row.lastError) return { error: row.lastError }
  return { ok: 'Refreshed' }
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
 * Generate KOT: moves ACCEPTED -> KOT_PRINTED and auto-queues the print —
 * no preview page, the manager stays on the order. Only called once per
 * order (this action does nothing if it's not ACCEPTED); the KOT page
 * itself, reached separately via ViewKotLink, is where a deliberate reprint
 * happens — see its Print button's route for that note.
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

    // Best-effort: the status change is what matters and must not be undone
    // by a printer problem. If this fails, the KOT page's own Print button
    // (the same enqueue, on demand) is the fallback.
    if (order.restaurantId) {
      try {
        assertPrintAgentConfigured()
        await enqueueOrderKotPrint({
          appOrigin: await getAppOrigin(),
          restaurantId: order.restaurantId,
          orderId,
        })
      } catch (err) {
        console.error(`[generateKot] auto-print enqueue failed for order ${orderId}:`, err)
      }
    }
  }

  redirect(`/store/orders/${orderId}`)
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

  // Snapshot before transitioning: whether to auto-print at all is decided
  // by whether this click actually moved anything, the same guard
  // generateKot uses — a repeat click on an already-printed run must not
  // fire another job. The ticket set printed is still the whole run,
  // matching what the /kot page shows and what its own Print button sends.
  const before = await findRun(ctx, runKey)
  const hasNewlyAccepted = (before?.orders ?? []).some((o) => o.status === 'ACCEPTED')

  await transitionRun(ctx, runKey, 'ACCEPTED', 'KOT_PRINTED', { via: 'store-board' })
  revalidatePath('/store')

  if (before && hasNewlyAccepted) {
    try {
      assertPrintAgentConfigured()
      await enqueueRunKotPrint({
        appOrigin: await getAppOrigin(),
        runKey,
        orders: before.orders,
      })
    } catch (err) {
      console.error(`[generateRunKot] auto-print enqueue failed for run ${runKey}:`, err)
    }
  }

  redirect('/store')
}

/**
 * Hands a whole train's ready food to a named rider and marks it on the way.
 *
 * The rider is recorded as the one carrying it, not the manager who clicked —
 * `handRunToRider` verifies the id belongs to an active rider before the
 * transition writes it.
 */
export async function handRunToRiderAction(
  _prev: StoreActionState,
  formData: FormData,
): Promise<StoreActionState> {
  const ctx = await requireRole('STORE_MANAGER', 'ADMIN')
  const runKey = String(formData.get('runKey') ?? '')
  const riderId = String(formData.get('riderId') ?? '')

  const result = await handRunToRider(ctx, runKey, riderId)
  revalidatePath('/store')
  revalidatePath('/agent')
  return summarise(result, 'on the way')
}
