'use client'

import { useActionState } from 'react'
import { login, type LoginState } from './actions'

const initial: LoginState = {}

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, initial)

  return (
    <form
      action={formAction}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <div>
        <label htmlFor="phone" className="mb-1 block text-sm font-medium text-slate-700">
          Phone number
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          inputMode="numeric"
          autoComplete="username"
          required
          placeholder="9000000001"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
        />
      </div>

      {state.error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-slate-900 px-3 py-2 font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}
