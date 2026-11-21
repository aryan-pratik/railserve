'use client'

import { useActionState, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { login, type LoginState } from './actions'

const initial: LoginState = {}

const inputClass =
  'h-11 w-full rounded-xl border border-v2-line-strong bg-v2-surface px-3.5 text-[15px] text-v2-ink outline-none placeholder:text-v2-faint focus:border-v2-brand focus:ring-[3px] focus:ring-v2-brand-soft'

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, initial)
  const [show, setShow] = useState(false)

  return (
    <form action={formAction} className="grid gap-4">
      {/* Phone, not email: there is no email field anywhere in the data model. */}
      <label className="grid gap-1.5 text-sm font-semibold" htmlFor="phone">
        Phone number
        <input
          id="phone"
          name="phone"
          type="tel"
          inputMode="numeric"
          autoComplete="username"
          required
          placeholder="10-digit mobile number"
          spellCheck={false}
          className={`${inputClass} font-mono tabular-nums`}
        />
      </label>

      <label className="grid gap-1.5 text-sm font-semibold" htmlFor="password">
        Password
        <span className="relative block">
          <input
            id="password"
            name="password"
            type={show ? 'text' : 'password'}
            autoComplete="current-password"
            required
            className={`${inputClass} pr-11`}
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? 'Hide password' : 'Show password'}
            aria-pressed={show}
            className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-v2-muted hover:bg-v2-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-brand"
          >
            {show ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
          </button>
        </span>
      </label>

      {state.error ? (
        <p role="alert" className="rounded-xl bg-v2-bad-bg px-3.5 py-2.5 text-sm font-medium text-v2-bad">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className="mt-1 inline-flex h-12 items-center justify-center rounded-full bg-v2-brand text-[15px] font-bold text-white transition-colors hover:bg-v2-brand-hover disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-brand focus-visible:ring-offset-2"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}
