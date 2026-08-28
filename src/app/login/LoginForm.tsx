'use client'

import { useActionState } from 'react'
import { Button, Field, inputClass } from '@/components/ui'
import { login, type LoginState } from './actions'

const initial: LoginState = {}

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, initial)

  return (
    <form
      action={formAction}
      className="space-y-4 rounded-xl border border-line bg-surface p-6 shadow-sm"
    >
      {/* Phone, not email — there is no email field anywhere in the data model. */}
      <Field label="Phone number" htmlFor="phone">
        <input
          id="phone"
          name="phone"
          type="tel"
          inputMode="numeric"
          autoComplete="username"
          required
          placeholder="9000000001"
          className={`${inputClass} font-mono tabular-nums`}
        />
      </Field>

      <Field label="Password" htmlFor="password">
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={inputClass}
        />
      </Field>

      {state.error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 ring-1 ring-inset ring-red-200">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  )
}
