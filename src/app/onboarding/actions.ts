'use server'

import { revalidatePath } from 'next/cache'
import { requireApplicant } from '@/lib/session'
import { OnboardingError, claimPayment } from '@/lib/repo/onboardingRepo'

export type ClaimState = { error?: string; ok?: string }

/** "I have paid": the reference goes to us to check. */
export async function claimPaymentAction(_prev: ClaimState, formData: FormData): Promise<ClaimState> {
  const me = await requireApplicant()
  try {
    await claimPayment(me.tenantId, String(formData.get('reference') ?? ''))
    revalidatePath('/onboarding')
    return { ok: 'Thank you. We will check your payment and confirm it here.' }
  } catch (err) {
    return { error: err instanceof OnboardingError ? err.message : 'Could not save that. Please try again.' }
  }
}
