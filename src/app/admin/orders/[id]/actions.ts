'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/session'
import { assignAgents, transitionOrder } from '@/lib/repo/transitionOrder'
import { addOrderItems, deleteOrder, findById, updateOrderFields, updateOrderItem } from '@/lib/repo/orderRepo'
import { forceRefreshTrainStatus } from '@/lib/train/service'
import {
  assertPrintAgentConfigured,
  enqueueOrderKotPrint,
  getAppOrigin,
} from '@/lib/printer/queue'
import type { OrderStatus } from '@/lib/orderStatus'
import type { RefreshTrainState } from '@/components/RefreshTrainButton'

export type ActionState = { error?: string; ok?: string }

/**
 * "Check now" for the train behind one order — see RefreshTrainButton. Any
 * order riding the same train shares this cache row, so one click updates
 * every board and detail view showing it, not just this order's.
 */
export async function forceRefreshOrderTrain(
  _prev: RefreshTrainState,
  formData: FormData,
): Promise<RefreshTrainState> {
  const ctx = await requireRole('ADMIN')
  const orderId = String(formData.get('orderId') ?? '')
  const order = await findById(ctx, orderId)
  if (!order) return { error: 'Order not found' }

  const row = await forceRefreshTrainStatus(order)
  revalidatePath(`/admin/orders/${orderId}`)
  revalidatePath('/admin')
  revalidatePath('/admin/orders')
  revalidatePath('/store')
  if (!row) return { error: 'This order has no train.' }
  if (row.lastError) return { error: row.lastError }
  return { ok: 'Refreshed' }
}

export async function assignAgentsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireRole('ADMIN')
  const orderId = String(formData.get('orderId') ?? '')
  const agentIds = formData.getAll('agentIds').map(String).filter(Boolean)

  try {
    await assignAgents({ ctx, orderId, agentIds })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not assign agents.' }
  }

  revalidatePath(`/admin/orders/${orderId}`)
  revalidatePath('/agent')
  return { ok: agentIds.length ? 'Agents assigned.' : 'Agents cleared.' }
}

/**
 * An admin moving an order along the pipeline — including, when the kitchen
 * cannot, printing its KOT.
 *
 * KOT_PRINTED is the one edge in the machine that carries a side effect: the
 * store board's generateKot() queues a print alongside the transition. This
 * generic path had no equivalent, so "Send KOT to kitchen" marked an order
 * printed and sent nothing — leaving no PrintJob row to notice it by, and
 * hiding the kitchen's own print button (it only shows while an order is
 * still ACCEPTED). Printing here is the whole point of the button's label.
 *
 * No delay guard, unlike the store's path: an admin reaching for this is
 * already handling an exception — usually a manager on the phone saying the
 * ticket never came out — and does not need to be asked whether they meant it.
 */
export async function adminTransitionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireRole('ADMIN')
  const orderId = String(formData.get('orderId') ?? '')
  const to = String(formData.get('to') ?? '') as OrderStatus

  // Read before the write: the print needs the outlet, and the transition
  // itself does not hand it back in a form this needs.
  const order = to === 'KOT_PRINTED' ? await findById(ctx, orderId) : null

  try {
    await transitionOrder({ ctx, orderId, to, meta: { via: 'admin-detail' } })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not update the order.' }
  }

  revalidatePath(`/admin/orders/${orderId}`)
  revalidatePath('/admin/orders')
  revalidatePath('/admin')
  revalidatePath('/store')

  if (to === 'KOT_PRINTED') {
    // `ok` is set on every return below, including the failures: the status
    // change has already committed, and the slide-over refreshes itself off
    // `ok` alone. Dropping it would leave the panel showing the old status
    // next to an error about the print. FormNote renders `error` in
    // preference to `ok`, so what the admin reads is still the problem.
    if (!order) {
      return { ok: 'Moved to KOT printed.', error: 'Moved to KOT printed, but the order vanished.' }
    }
    try {
      assertPrintAgentConfigured()
      // Routed by station, and every order has one — an order whose outlet
      // matching failed used to be unprintable and now is not.
      await enqueueOrderKotPrint({
        appOrigin: await getAppOrigin(),
        stationCode: order.stationCode,
        restaurantId: order.restaurantId,
        orderId,
      })
    } catch (err) {
      // Reported, not swallowed. The store board's equivalent logs and moves
      // on because a printer fault must not stall a kitchen mid-service; an
      // admin pressing this is already chasing a print that did not happen,
      // and a second silent failure is the worst possible answer.
      console.error(`[adminTransitionAction] KOT print enqueue failed for order ${orderId}:`, err)
      return {
        ok: 'Moved to KOT printed.',
        error: `Moved to KOT printed, but the print could not be queued: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      }
    }
    return { ok: 'KOT sent to the kitchen printer.' }
  }

  return { ok: `Order moved to ${to.replace('_', ' ')}.` }
}

/** Permanent. Redirects back to the list since the detail page it ran from is gone. */
export async function deleteOrderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireRole('ADMIN')
  const orderId = String(formData.get('orderId') ?? '')

  let ok: boolean
  try {
    ok = await deleteOrder(ctx, orderId)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not delete the order.' }
  }
  if (!ok) return { error: 'Order not found.' }

  revalidatePath('/admin/orders')
  revalidatePath('/store')
  redirect('/admin/orders')
}

export async function updateOrderItemAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireRole('ADMIN')
  const orderId = String(formData.get('orderId') ?? '')
  const itemId = String(formData.get('itemId') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  const qty = Number(formData.get('qty'))
  const rawPrice = String(formData.get('pricePaise') ?? '').trim()
  const notes = String(formData.get('notes') ?? '').trim()

  if (!name) return { error: 'Item name is required.' }
  if (!Number.isInteger(qty) || qty < 1) return { error: 'Quantity must be at least 1.' }
  if (rawPrice && (!Number.isFinite(Number(rawPrice)) || Number(rawPrice) < 0)) {
    return { error: 'Price must be a positive number.' }
  }

  try {
    const ok = await updateOrderItem(ctx, orderId, itemId, {
      name,
      qty,
      pricePaise: rawPrice ? Math.round(Number(rawPrice) * 100) : null,
      notes: notes.length > 0 ? notes : null,
    })
    if (!ok) return { error: 'Item not found.' }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not save the item.' }
  }

  revalidatePath(`/admin/orders/${orderId}`)
  revalidatePath(`/store/orders/${orderId}`)
  return { ok: 'Item updated.' }
}

export async function addOrderItemAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireRole('ADMIN')
  const orderId = String(formData.get('orderId') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  const qty = Number(formData.get('qty'))
  const rawPrice = String(formData.get('pricePaise') ?? '').trim()
  const notes = String(formData.get('notes') ?? '').trim()

  if (!name) return { error: 'Item name is required.' }
  if (!Number.isInteger(qty) || qty < 1) return { error: 'Quantity must be at least 1.' }
  if (rawPrice && (!Number.isFinite(Number(rawPrice)) || Number(rawPrice) < 0)) {
    return { error: 'Price must be a positive number.' }
  }

  try {
    const ok = await addOrderItems(ctx, orderId, [{
      name,
      qty,
      pricePaise: rawPrice ? Math.round(Number(rawPrice) * 100) : null,
      notes: notes.length > 0 ? notes : null,
      isPacking: false,
    }])
    if (!ok) return { error: 'Order not found.' }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not add the item.' }
  }

  revalidatePath(`/admin/orders/${orderId}`)
  revalidatePath(`/store/orders/${orderId}`)
  return { ok: 'Item added.' }
}

export async function updateOrderRemarkAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireRole('ADMIN')
  const orderId = String(formData.get('orderId') ?? '')
  const raw = String(formData.get('remark') ?? '').trim()
  if (raw.length > 500) return { error: 'Keep the remark under 500 characters.' }
  const remark = raw.length > 0 ? raw : null

  try {
    const ok = await updateOrderFields(ctx, orderId, { remark })
    if (!ok) return { error: 'Order not found.' }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not save the remark.' }
  }

  revalidatePath(`/admin/orders/${orderId}`)
  revalidatePath(`/store/orders/${orderId}`)
  revalidatePath('/store')
  return { ok: 'Remark saved.' }
}
