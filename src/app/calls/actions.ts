'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/session'
import { transitionOrder } from '@/lib/repo/transitionOrder'

export type CallActionState = { error?: string; ok?: string }

/**
 * The telecaller's cancellation.
 *
 * The passenger has said on the phone that they no longer want the order, and
 * this is where that sentence stops being a WhatsApp message somebody has to
 * notice and becomes a status the kitchen board and the rider's screen react
 * to on their own.
 *
 * A reason is required. "Cancelled" with nobody's account of why is the shape
 * of a dispute nobody can settle later, and the telecaller is the only person
 * on the call — if they do not write it down here, it is not written down
 * anywhere. It lands in the event log next to who did it and when, and the
 * live alert repeats it verbatim to the kitchen.
 *
 * Everything that decides whether this is allowed at all lives one layer
 * down: transitionOrder re-reads the order through the caller's scope, so an
 * order from an outlet this telecaller does not hold is a 404 rather than a
 * refusal, and the TRANSITIONS allow-list is what says a telecaller may cancel
 * from RECEIVED/ACCEPTED/KOT_PRINTED/PREPARED and nowhere else.
 */
export async function cancelOrder(
  _prev: CallActionState,
  formData: FormData,
): Promise<CallActionState> {
  const ctx = await requireRole('TELECALLER')
  const orderId = String(formData.get('orderId') ?? '')
  const reason = String(formData.get('reason') ?? '').trim()

  if (reason.length < 3) {
    return { error: 'Say briefly why the passenger cancelled: the kitchen sees this.' }
  }
  // Same cap as the admin remark and a call note. The textarea's maxLength is
  // a courtesy; this is the one that holds.
  if (reason.length > 500) {
    return { error: 'Keep the reason under 500 characters.' }
  }

  try {
    await transitionOrder({
      ctx,
      orderId,
      to: 'CANCELLED',
      meta: { via: 'telecaller-call', reason },
    })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not cancel the order.' }
  }

  revalidatePath('/calls')
  revalidatePath('/calls/live')
  revalidatePath(`/calls/orders/${orderId}`)
  // The kitchen board and the rider's runs both drop the order the moment it
  // leaves LIVE_STATUSES; revalidating here means a manager who navigates
  // rather than waiting for the live feed still sees the truth.
  revalidatePath('/store')
  revalidatePath(`/store/orders/${orderId}`)
  revalidatePath('/agent')
  revalidatePath('/admin')
  revalidatePath(`/admin/orders/${orderId}`)

  return { ok: 'Order cancelled. The kitchen has been told.' }
}
