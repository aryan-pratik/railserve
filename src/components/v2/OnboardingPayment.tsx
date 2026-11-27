'use client'

import { useActionState } from 'react'
import { claimPaymentAction, type ClaimState } from '@/app/onboarding/actions'

const initial: ClaimState = {}

/** "I have paid", with the reference number from the UPI app or bank. */
export function OnboardingPaymentForm() {
  const [state, action, pending] = useActionState(claimPaymentAction, initial)
  return (
    <form action={action} className="grid gap-2">
      <label className="grid gap-1.5 text-sm font-semibold" htmlFor="pay-ref">
        After paying, enter the reference number
        <span className="text-[12.5px] font-normal text-v2-muted">The UPI reference (UTR) or bank transaction number from your payment screen.</span>
      </label>
      <span className="flex flex-wrap gap-2">
        <input id="pay-ref" name="reference" required minLength={4} maxLength={80} className="h-11 min-w-0 flex-1 rounded-xl border border-v2-line-strong bg-v2-surface px-3.5 font-mono text-[15px] outline-none focus:border-v2-brand focus:ring-[3px] focus:ring-v2-brand-soft" placeholder="e.g. 432109876543" />
        <button type="submit" disabled={pending} className="h-11 rounded-full bg-v2-brand px-5 text-[14px] font-bold text-white hover:bg-v2-brand-hover disabled:opacity-60">
          {pending ? 'Sending…' : 'I have paid'}
        </button>
      </span>
      {state.error ? <p role="alert" className="text-[13px] font-semibold text-v2-bad">{state.error}</p> : null}
      {state.ok ? <p className="text-[13px] font-semibold text-v2-ok">{state.ok}</p> : null}
    </form>
  )
}
