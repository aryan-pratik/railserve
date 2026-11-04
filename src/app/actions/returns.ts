'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/session'
import { markReturnedToOrigin } from '@/lib/repo/rtoRepo'

export type ReturnActionState = { error?: string; ok?: string }

/** Every screen a return shows up on. */
function revalidateAll(orderId: string) {
  revalidatePath(`/store/orders/${orderId}`)
  revalidatePath(`/calls/orders/${orderId}`)
  revalidatePath(`/admin/orders/${orderId}`)
  revalidatePath(`/agent/orders/${orderId}`)
  revalidatePath('/store/returns')
  revalidatePath('/calls/returns')
  revalidatePath('/admin/returns')
  revalidatePath('/store')
  revalidatePath('/calls')
  revalidatePath('/admin')
}

/**
 * Somebody at the origin outlet has the bag back. The repository holds every
 * rule — the tick on the manager's staff record, the outlet scope, one mark
 * per return — and this turns its refusals into a sentence beside the
 * button. The role gate here is only the widest possible set; the
 * repository decides for each manager.
 */
export async function markReturnedAction(
  _prev: ReturnActionState,
  formData: FormData,
): Promise<ReturnActionState> {
  const ctx = await requireRole('STORE_MANAGER', 'ADMIN')
  const orderId = String(formData.get('orderId') ?? '')
  const note = String(formData.get('note') ?? '')
  try {
    await markReturnedToOrigin({ ctx, orderId, note })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not record the return.' }
  }
  revalidateAll(orderId)
  return { ok: 'Marked returned to the outlet.' }
}
