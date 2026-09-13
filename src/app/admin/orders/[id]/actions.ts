'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/session'
import { assignAgents, transitionOrder } from '@/lib/repo/transitionOrder'
import { addOrderItems, deleteOrder, findById, updateOrderFields, updateOrderItem } from '@/lib/repo/orderRepo'
import { forceRefreshTrainStatus } from '@/lib/train/service'
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

export async function adminTransitionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireRole('ADMIN')
  const orderId = String(formData.get('orderId') ?? '')
  const to = String(formData.get('to') ?? '') as OrderStatus

  try {
    await transitionOrder({ ctx, orderId, to, meta: { via: 'admin-detail' } })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not update the order.' }
  }

  revalidatePath(`/admin/orders/${orderId}`)
  revalidatePath('/admin/orders')
  revalidatePath('/store')
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
