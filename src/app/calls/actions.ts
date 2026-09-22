'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/session'
import { transitionOrder, flagRatingOrder as flagRatingOrderRepo } from '@/lib/repo/transitionOrder'
import type { OrderStatus } from '@/lib/orderStatus'

export type CallActionState = { error?: string; ok?: string }

/** Revalidates every screen an order can currently be visible on. */
function revalidateOrder(orderId: string) {
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
}

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

  revalidateOrder(orderId)
  return { ok: 'Order cancelled. The kitchen has been told.' }
}

/**
 * The three other support-call outcomes a telecaller records from whatever a
 * passenger says on the phone: the food went to the wrong seat/person
 * (misdelivery), it never arrived at all (missed delivery), or the passenger
 * is owed their money back (refunded). Unlike cancellation these are open
 * from any non-terminal status — see the TRANSITIONS comment in
 * orderStatus.ts — because they are told to the telecaller after the fact,
 * not chosen from a fixed pipeline step.
 *
 * One function per status rather than one parameterized action: each keeps
 * its own copy and its own reason requirement, and a caller cannot typo a
 * `to` value past the type checker the way a single generic action's
 * FormData string could.
 */
async function markOutcome(
  to: OrderStatus,
  cannotMessage: string,
  formData: FormData,
): Promise<CallActionState> {
  const ctx = await requireRole('TELECALLER')
  const orderId = String(formData.get('orderId') ?? '')
  const reason = String(formData.get('reason') ?? '').trim()

  if (reason.length < 3) {
    return { error: 'Say briefly what happened: this is what the outlet and admin will see.' }
  }
  if (reason.length > 500) {
    return { error: 'Keep the reason under 500 characters.' }
  }

  try {
    await transitionOrder({ ctx, orderId, to, meta: { via: 'telecaller-call', reason } })
  } catch (err) {
    return { error: err instanceof Error ? err.message : cannotMessage }
  }

  revalidateOrder(orderId)
  return { ok: 'Order updated.' }
}

export async function markMisdelivery(
  _prev: CallActionState,
  formData: FormData,
): Promise<CallActionState> {
  return markOutcome('MISDELIVERY', 'Could not mark the order as misdelivered.', formData)
}

export async function markMissedDelivery(
  _prev: CallActionState,
  formData: FormData,
): Promise<CallActionState> {
  return markOutcome('MISSED_DELIVERY', 'Could not mark the delivery as missed.', formData)
}

export async function markRefunded(
  _prev: CallActionState,
  formData: FormData,
): Promise<CallActionState> {
  return markOutcome('REFUNDED', 'Could not mark the order as refunded.', formData)
}

/**
 * Flags a decoy order run purely to prompt an app-store rating. Deliberately
 * no reason field — this is a single-tap reclassification, not a call
 * outcome that needs explaining — and it works on any order, including
 * already-terminal ones, because a fake order can be spotted after the fact.
 * See `flagRatingOrder` in transitionOrder.ts for why this bypasses the
 * normal TRANSITIONS allow-list.
 */
export async function flagRatingOrder(
  _prev: CallActionState,
  formData: FormData,
): Promise<CallActionState> {
  const ctx = await requireRole('TELECALLER')
  const orderId = String(formData.get('orderId') ?? '')
  const note = String(formData.get('note') ?? '').trim()

  try {
    await flagRatingOrderRepo({
      ctx,
      orderId,
      meta: note ? { note } : {},
    })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not flag this order.' }
  }

  revalidateOrder(orderId)
  return { ok: 'Marked as a rating order.' }
}
