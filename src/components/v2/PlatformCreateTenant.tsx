'use client'

import { useActionState } from 'react'
import { createTenantAction, type PlatformState } from '@/app/platform/actions'
import { Button, Card } from './ui'
import { Field, inputClass } from './SettingsForm'
import { Notice } from './Table'

const initial: PlatformState = {}

/** Onboard a customer: the company and the one admin who sets up the rest. */
export function PlatformCreateTenant() {
  const [state, action, pending] = useActionState(createTenantAction, initial)
  return (
    <Card title="Add a company">
      <form action={action} className="grid gap-3 sm:grid-cols-2">
        <Field className="content-start" label="Company name" htmlFor="t-name">
          <input id="t-name" name="name" required maxLength={120} className={inputClass} />
        </Field>
        <Field className="content-start" label="Handle" htmlFor="t-slug" hint="Optional. Lowercase, used in their order-mail address later.">
          <input id="t-slug" name="slug" maxLength={40} pattern="[a-z0-9-]*" className={inputClass} />
        </Field>
        <Field className="content-start" label="First admin's name" htmlFor="t-admin">
          <input id="t-admin" name="adminName" required maxLength={80} className={inputClass} />
        </Field>
        <Field className="content-start" label="First admin's phone" htmlFor="t-phone" hint="They sign in with this.">
          <input id="t-phone" name="adminPhone" required inputMode="numeric" maxLength={14} className={inputClass} />
        </Field>
        <Field className="content-start" label="Temporary password" htmlFor="t-pass" hint="Share it privately; they should change it.">
          <input id="t-pass" name="adminPassword" required minLength={8} type="text" autoComplete="off" className={inputClass} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field className="content-start" label="Outlet limit" htmlFor="t-outlets">
            <input id="t-outlets" name="maxOutlets" type="number" min={1} max={500} defaultValue={10} className={inputClass} />
          </Field>
          <Field className="content-start" label="Staff limit" htmlFor="t-users">
            <input id="t-users" name="maxUsers" type="number" min={1} max={5000} defaultValue={100} className={inputClass} />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? 'Creating…' : 'Create company'}
          </Button>
          {state.error ? <Notice tone="bad">{state.error}</Notice> : state.ok ? <Notice tone="ok">{state.ok}</Notice> : null}
        </div>
      </form>
    </Card>
  )
}
