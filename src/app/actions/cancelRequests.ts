'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/session'
import {
  approveCancellation,
  refuseCancellation,
  requestCancellation,
} from '@/lib/repo/cancelRequestRepo'

export type CancelRequestState = { error?: string; ok?: string }

/** Every screen a request, its answer, or the cancel itself shows up on. */
function revalidateAll(orderId: string) {
  revalidatePath(`/store/orders/${orderId}`)
  revalidatePath(`/calls/orders/${orderId}`)
  revalidatePath(`/admin/orders/${orderId}`)
  revalidatePath('/store')
  revalidatePath('/calls')
  revalidatePath('/calls/live')
  revalidatePath('/admin')
  revalidatePath('/agent')
}

/**
 * A store manager asks for an order to be cancelled. The repository holds
 * every rule (role, scope, status, one pending request at a time); this only
 * turns its refusals into a sentence on the form.
 */
export async function requestCancellationAction(
  _prev: CancelRequestState,
  formData: FormData,
): Promise<CancelRequestState> {
  const ctx = await requireRole('STORE_MANAGER')
  const orderId = String(formData.get('orderId') ?? '')
  const reason = String(formData.get('reason') ?? '')
  try {
    await requestCancellation(ctx, orderId, reason)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not send the request.' }
  }
  revalidateAll(orderId)
  return { ok: 'Request sent. The call desk or an admin will accept or refuse it.' }
}

/** A telecaller or an admin answers. `decision` is the button that was pressed. */
export async function decideCancellationAction(
  _prev: CancelRequestState,
  formData: FormData,
): Promise<CancelRequestState> {
  const ctx = await requireRole('TELECALLER', 'ADMIN')
  const orderId = String(formData.get('orderId') ?? '')
  const decision = String(formData.get('decision') ?? '')
  const note = String(formData.get('note') ?? '')
  try {
    if (decision === 'approve') {
      await approveCancellation(ctx, orderId)
    } else if (decision === 'refuse') {
      await refuseCancellation(ctx, orderId, note)
    } else {
      return { error: 'Choose accept or refuse.' }
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not answer the request.' }
  }
  revalidateAll(orderId)
  return { ok: decision === 'approve' ? 'Order cancelled. The kitchen has been told.' : 'Request refused.' }
}
