'use server'

import { revalidatePath } from 'next/cache'
import { updatePaymentRemarkAction as updateV1, type PaymentActionState } from '@/app/actions/payments'

export type { PaymentActionState }

/** The shared remark action, with the v2 ledger revalidated as well. */
export async function updatePaymentRemark(prev: PaymentActionState, formData: FormData): Promise<PaymentActionState> {
  const r = await updateV1(prev, formData)
  if (r.ok) revalidatePath('/v2/payments')
  return r
}
