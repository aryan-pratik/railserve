'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/session'
import { setPaymentRemark } from '@/lib/repo/paymentRepo'

export type PaymentActionState = { error?: string; ok?: string }

/**
 * Remark editing for both consoles.
 *
 * An admin and a store manager write the same note against the same payment;
 * setPaymentRemark already refuses any other role, so there is nothing
 * role-specific left to duplicate into two copies of this file.
 */
export async function updatePaymentRemarkAction(
  _prev: PaymentActionState,
  formData: FormData,
): Promise<PaymentActionState> {
  const ctx = await requireRole('ADMIN', 'STORE_MANAGER')
  const paymentId = String(formData.get('paymentId') ?? '')
  const raw = String(formData.get('remark') ?? '').trim()

  try {
    // Emptying the box clears the remark rather than storing '', so the table
    // shows a real dash and the search does not match every blank row.
    await setPaymentRemark(ctx, paymentId, raw || null)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not save the remark.' }
  }

  revalidatePath('/admin/payments')
  revalidatePath('/store/payments')
  return { ok: raw ? 'Remark saved.' : 'Remark cleared.' }
}
