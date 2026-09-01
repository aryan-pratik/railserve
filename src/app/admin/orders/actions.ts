'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/session'
import { updateOrderFields } from '@/lib/repo/orderRepo'
import { adminOverrideStatus } from '@/lib/repo/transitionOrder'
import { normalizeCustomStatus } from '@/lib/orderStatus'
import { rupeesToPaise } from '@/lib/format'
import { statusLabel } from '@/components/ui'

export type ActionState = { error?: string; ok?: string }

export async function updateOrderAmountAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireRole('ADMIN')
  const orderId = String(formData.get('orderId') ?? '')
  const amountPaise = rupeesToPaise(String(formData.get('amountRupees') ?? ''))
  if (amountPaise === null) {
    return { error: 'Enter a valid amount.' }
  }

  try {
    const ok = await updateOrderFields(ctx, orderId, { amountPaise })
    if (!ok) return { error: 'Order not found.' }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not update the amount.' }
  }

  revalidatePath('/admin/orders')
  return { ok: 'Amount updated.' }
}

export async function updateOrderStatusAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireRole('ADMIN')
  const orderId = String(formData.get('orderId') ?? '')
  const to = normalizeCustomStatus(String(formData.get('to') ?? ''))
  if (!to) {
    return { error: 'Enter a status.' }
  }

  try {
    await adminOverrideStatus({ ctx, orderId, to, meta: { via: 'admin-orders-list' } })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not update the status.' }
  }

  revalidatePath('/admin/orders')
  return { ok: `Status set to ${statusLabel(to)}.` }
}
