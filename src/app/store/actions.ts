'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/session'
import { findById } from '@/lib/repo/orderRepo'
import { transitionOrder } from '@/lib/repo/transitionOrder'
import { NotFoundError } from '@/lib/authContext'

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
