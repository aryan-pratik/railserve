'use client'

import { useActionState } from 'react'
import { Button, Field, Notice, inputClass } from '@/components/ui'
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
          placeholder="10-digit mobile number"
          spellCheck={false}
          className={`${inputClass} h-11 font-mono tabular-nums`}
        />
      </Field>

      <Field label="Password" htmlFor="password">
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={`${inputClass} h-11`}
        />
      </Field>

      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}

      <Button type="submit" size="lg" pending={pending} className="w-full">
        Sign in
      </Button>
    </form>
  )
}
