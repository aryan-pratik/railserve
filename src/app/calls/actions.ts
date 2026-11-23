'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/session'
import { transitionOrder, flagRatingOrder as flagRatingOrderRepo, recordRefund, clearRefund } from '@/lib/repo/transitionOrder'
import { findById } from '@/lib/repo/orderRepo'
import { FAILURE_REASONS, REFUND_PAYERS, REFUND_REASONS, reasonLabel, type RefundPayer, type RefundReason } from '@/lib/orderStatus'

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
 * from RECEIVED through DISPATCHED and nowhere else.
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
 * The old one-tap support outcomes, kept so a screen still posting to them
 * keeps working. Each is now what it always meant: misdelivery and missed
 * delivery are "not delivered" with that reason, and refunded is a refund of
 * the whole order on top of its real status.
 */
export async function markMisdelivery(_prev: CallActionState, formData: FormData): Promise<CallActionState> {
  formData.set('reasonCode', 'WRONG_PASSENGER')
  return markNotDelivered(_prev, formData)
}

export async function markMissedDelivery(_prev: CallActionState, formData: FormData): Promise<CallActionState> {
  formData.set('reasonCode', 'MISSED_TRAIN')
  return markNotDelivered(_prev, formData)
}

export async function markRefunded(_prev: CallActionState, formData: FormData): Promise<CallActionState> {
  formData.set('reasonCode', 'OTHER')
  formData.set('note', String(formData.get('reason') ?? ''))
  formData.set('full', '1')
  return recordRefundAction(_prev, formData)
}

/**
 * Money paid back to the passenger: amount (rupees; "full" means the whole
 * order), why, and who paid it. The order keeps its status.
 */
export async function recordRefundAction(_prev: CallActionState, formData: FormData): Promise<CallActionState> {
  const ctx = await requireRole('TELECALLER', 'ADMIN')
  const orderId = String(formData.get('orderId') ?? '')
  const reason = String(formData.get('reasonCode') ?? '') as RefundReason
  const payerRaw = String(formData.get('payer') ?? '')
  const payer = payerRaw in REFUND_PAYERS ? (payerRaw as RefundPayer) : null
  const note = String(formData.get('note') ?? '').trim() || null
  let amountPaise: number
  if (formData.get('full') === '1') {
    const order = await findById(ctx, orderId).catch(() => null)
    amountPaise = order?.amountPaise ?? 0
  } else {
    const rupees = Number(String(formData.get('amount') ?? '').replace(/[,₹\s]/g, ''))
    amountPaise = Math.round(rupees * 100)
  }
  if (!(reason in REFUND_REASONS)) return { error: 'Pick why the money was paid back.' }
  if (!Number.isFinite(amountPaise) || amountPaise <= 0) return { error: 'Enter the amount paid back, like 236.' }

  try {
    await recordRefund({ ctx, orderId, amountPaise, reason, payer, note })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not record the refund.' }
  }
  revalidateOrder(orderId)
  revalidatePath(`/v2/orders/${orderId}`)
  return { ok: `Refund of ₹${(amountPaise / 100).toLocaleString('en-IN')} recorded.` }
}

export async function clearRefundAction(_prev: CallActionState, formData: FormData): Promise<CallActionState> {
  const ctx = await requireRole('TELECALLER', 'ADMIN')
  const orderId = String(formData.get('orderId') ?? '')
  try {
    await clearRefund({ ctx, orderId })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not remove the refund.' }
  }
  revalidateOrder(orderId)
  revalidatePath(`/v2/orders/${orderId}`)
  return { ok: 'Refund removed.' }
}

/**
 * The passenger confirms on the phone that the food arrived.
 *
 * No reason field: "delivered" needs no explaining, and a box nobody fills in
 * would only slow down the one outcome that is good news. Open from PREPARED
 * and DISPATCHED, so a delivery the rider never tapped through can still be
 * closed out from the call desk.
 */
export async function markDelivered(
  _prev: CallActionState,
  formData: FormData,
): Promise<CallActionState> {
  const ctx = await requireRole('TELECALLER')
  const orderId = String(formData.get('orderId') ?? '')

  try {
    await transitionOrder({ ctx, orderId, to: 'DELIVERED', meta: { via: 'telecaller-call' } })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not mark the order delivered.' }
  }

  revalidateOrder(orderId)
  return { ok: 'Marked delivered.' }
}

/**
 * Not delivered: the food did not reach the passenger. Recorded as FAILED, the
 * same status a rider sets from the platform, with the reason written to
 * `delivery.failureReason` exactly where the rider's own reason would go.
 */
export async function markNotDelivered(
  _prev: CallActionState,
  formData: FormData,
): Promise<CallActionState> {
  const ctx = await requireRole('TELECALLER')
  const orderId = String(formData.get('orderId') ?? '')
  const code = String(formData.get('reasonCode') ?? '')
  const text = String(formData.get('reason') ?? '').trim()
  const known = code in FAILURE_REASONS && code !== 'OTHER'

  // A picked reason is enough; "Other" (or an old screen with only a text
  // box) needs a few words, since that is all anyone will know later.
  if (!known && text.length < 3) {
    return { error: 'Pick a reason, or say briefly what happened: the outlet and admin will see this.' }
  }
  if (text.length > 500) {
    return { error: 'Keep the reason under 500 characters.' }
  }
  const failureReason = known ? code : text

  try {
    await transitionOrder({
      ctx,
      orderId,
      to: 'FAILED',
      meta: { via: 'telecaller-call', reason: known ? reasonLabel(code) : text, ...(known && text ? { note: text } : {}) },
      apply: { failureReason },
    })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not mark the order not delivered.' }
  }

  revalidateOrder(orderId)
  return { ok: 'Marked not delivered.' }
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
  const ctx = await requireRole('TELECALLER', 'ADMIN')
  const orderId = String(formData.get('orderId') ?? '')
  const note = String(formData.get('note') ?? '').trim()
  const on = formData.get('on') !== '0'

  try {
    await flagRatingOrderRepo({
      ctx,
      orderId,
      on,
      meta: note ? { note } : {},
    })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not flag this order.' }
  }

  revalidateOrder(orderId)
  revalidatePath(`/v2/orders/${orderId}`)
  return { ok: on ? 'Tagged as a rating order.' : 'Rating order tag removed.' }
}
