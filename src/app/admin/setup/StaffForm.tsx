'use client'

import { useActionState, useState } from 'react'
import { Button, Card, CardHeader, Field, FormNote, inputClass } from '@/components/ui'
import { saveUser, type UserState } from './staffActions'

const initial: UserState = {}

export function StaffForm({ outlets }: { outlets: { id: string; label: string }[] }) {
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

        <Field label="Outlets"
          hint={
            role === 'ADMIN'
              ? 'Admins see every outlet, so they hold none explicitly.'
              : role === 'STORE_MANAGER'
                ? 'Tick every outlet this manager runs — all of them share one board.'
                : 'Riders see the live runs of the outlets they are attached to. Without one, their app is empty.'
          }>
          <div className="space-y-1.5">
            {outlets.map((o) => (
              <label key={o.id} className="flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" name="restaurantIds" value={o.id}
                  disabled={role === 'ADMIN'}
                  className="size-4 rounded border-line-strong disabled:opacity-40" />
                {o.label}
              </label>
            ))}
          </div>
        </Field>

        <Field label="Initial password" htmlFor="password">
          <input id="password" name="password" type="text" className={inputClass} />
        </Field>

        <div className="sm:col-span-2 flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Create staff member'}
          </Button>
          <FormNote state={state} />
        </div>
      </form>
    </Card>
  )
}
