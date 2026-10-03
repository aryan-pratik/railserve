'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/session'
import { assignRiders } from '@/lib/repo/transitionOrder'

export type AssignRidersState = { error?: string; ok?: string }

/**
 * A telecaller, store manager or admin picks the riders for one order. The
 * repository holds every rule (role, scope, open order, active riders at the
 * outlet); this only turns its refusals into a sentence on the form.
 */
export async function assignRidersAction(
  _prev: AssignRidersState,
  formData: FormData,
): Promise<AssignRidersState> {
  const ctx = await requireRole('TELECALLER', 'STORE_MANAGER', 'ADMIN')
  const orderId = String(formData.get('orderId') ?? '')
  const riderIds = formData.getAll('riderIds').map(String).filter(Boolean)

  try {
    await assignRiders({ ctx, orderId, riderIds })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not assign the rider.' }
  }

  revalidatePath(`/calls/orders/${orderId}`)
  revalidatePath(`/store/orders/${orderId}`)
  revalidatePath(`/admin/orders/${orderId}`)
  revalidatePath('/calls')
  revalidatePath('/store')
  revalidatePath('/admin')
  revalidatePath('/agent')
  return { ok: riderIds.length ? 'Rider assigned.' : 'Rider removed.' }
}
