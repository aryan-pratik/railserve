'use client'

import { useActionState, useState } from 'react'
import { Card, CardHeader, Field, inputClass } from '@/components/ui'
import { saveUser, type UserState } from './actions'

const initial: UserState = {}

export function UserForm({ outlets }: { outlets: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState(saveUser, initial)
  const [role, setRole] = useState('STORE_MANAGER')

  return (
    <Card>
      <CardHeader title="Add staff" />
      <form action={action} className="grid gap-4 p-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="name">
          <input id="name" name="name" required className={inputClass} />
        </Field>

        <Field label="Phone" htmlFor="phone" hint="This is their login identifier.">
          <input id="phone" name="phone" required inputMode="numeric" className={inputClass} />
        </Field>

        <Field label="Role" htmlFor="role">
          <select id="role" name="role" value={role} onChange={(e) => setRole(e.target.value)}
            className={inputClass}>
            <option value="STORE_MANAGER">Store manager</option>
            <option value="DELIVERY_AGENT">Delivery agent</option>
            <option value="ADMIN">Admin</option>
          </select>
        </Field>

        <Field label="Outlet" htmlFor="restaurantId"
          hint={role === 'STORE_MANAGER' ? 'Required — this is what scopes their dashboard.' : 'Only store managers belong to an outlet.'}>
          <select id="restaurantId" name="restaurantId" disabled={role !== 'STORE_MANAGER'}
            className={inputClass}>
            <option value="">—</option>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Initial password" htmlFor="password">
          <input id="password" name="password" type="text" className={inputClass} />
        </Field>

        <div className="sm:col-span-2 flex items-center gap-3">
          <button type="submit" disabled={pending}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60">
            {pending ? 'Saving…' : 'Create staff member'}
          </button>
          {state.error ? <span className="text-sm font-medium text-red-600">{state.error}</span> : null}
          {state.ok ? <span className="text-sm font-medium text-emerald-700">{state.ok}</span> : null}
        </div>
      </form>
    </Card>
  )
}
