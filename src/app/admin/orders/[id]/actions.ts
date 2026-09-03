'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/session'
import { assignAgents, transitionOrder } from '@/lib/repo/transitionOrder'
import { findById } from '@/lib/repo/orderRepo'
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
