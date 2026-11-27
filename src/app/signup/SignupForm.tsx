'use client'

import { useActionState, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { signup, type SignupState } from './actions'

const initial: SignupState = {}

const inputClass =
  'h-11 w-full rounded-xl border border-v2-line-strong bg-v2-surface px-3.5 text-[15px] text-v2-ink outline-none placeholder:text-v2-faint focus:border-v2-brand focus:ring-[3px] focus:ring-v2-brand-soft'

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold">
      {label}
      {children}
      {help ? <span className="text-[12.5px] font-normal text-v2-muted">{help}</span> : null}
    </label>
  )
}

export function SignupForm() {
  const [state, action, pending] = useActionState(signup, initial)
  const [show, setShow] = useState(false)
  const v = state.values ?? {}
  return (
    <form action={action} className="grid gap-4">
      <Field label="Business name" help="As it appears on your FSSAI licence.">
        <input name="businessName" required defaultValue={v.businessName} autoComplete="organization" className={inputClass} placeholder="e.g. Bite Station Gaya" />
      </Field>
      <Field label="Your name">
        <input name="ownerName" required defaultValue={v.ownerName} autoComplete="name" className={inputClass} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Mobile number" help="You will sign in with this.">
          <input name="phone" type="tel" inputMode="numeric" required defaultValue={v.phone} autoComplete="tel" placeholder="10-digit mobile number" className={`${inputClass} font-mono tabular-nums`} />
        </Field>
        <Field label="Email" help="We send updates about your application here.">
          <input name="email" type="email" required defaultValue={v.email} autoComplete="email" className={inputClass} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Password" help="At least 8 characters.">
          <span className="relative block">
            <input name="password" type={show ? 'text' : 'password'} required minLength={8} autoComplete="new-password" className={`${inputClass} pr-11`} />
            <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-v2-muted hover:bg-v2-surface-2">
              {show ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
            </button>
          </span>
        </Field>
        <Field label="Password again">
          <input name="password2" type={show ? 'text' : 'password'} required minLength={8} autoComplete="new-password" className={inputClass} />
        </Field>
      </div>

      {state.error ? (
        <p role="alert" className="rounded-xl bg-v2-bad-bg px-3.5 py-2.5 text-sm font-medium text-v2-bad">
          {state.error}
        </p>
      ) : null}

      <button type="submit" disabled={pending} aria-busy={pending} className="mt-1 inline-flex h-12 items-center justify-center rounded-full bg-v2-brand text-[15px] font-bold text-white transition-colors hover:bg-v2-brand-hover disabled:opacity-60">
        {pending ? 'Creating your account…' : 'Create account and continue'}
      </button>
    </form>
  )
}
