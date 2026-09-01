'use client'

import { useActionState, useState } from 'react'
import { Button, Card, CardHeader, Field, FormNote, inputClass } from '@/components/ui'
import { saveUser, type UserState } from './staffActions'
import { OutletMultiSelect } from './OutletMultiSelect'

const initial: UserState = {}

export type StaffValues = {
  id?: string
  name?: string
  phone?: string
  role?: string
  restaurantIds?: string[]
}

export function StaffForm({
  outlets, values = {},
}: {
  outlets: { id: string; label: string }[]
  values?: StaffValues
}) {
  const [state, action, pending] = useActionState(saveUser, initial)
  const [role, setRole] = useState(values.role ?? 'STORE_MANAGER')

  return (
    <Card>
      <CardHeader title={values.id ? 'Edit staff' : 'Add staff'} />
      <form action={action} className="grid gap-4 p-4 sm:grid-cols-2">
        {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

        <Field label="Name" htmlFor="name">
          <input id="name" name="name" required defaultValue={values.name} className={inputClass} />
        </Field>

        <Field label="Phone" htmlFor="phone" hint="This is their login identifier.">
          <input id="phone" name="phone" required inputMode="numeric" defaultValue={values.phone}
            className={inputClass} />
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
                ? 'Every outlet this manager runs — all of them share one board.'
                : 'Riders see the live runs of the outlets they are attached to. Without one, their app is empty.'
          }>
          <OutletMultiSelect
            name="restaurantIds"
            options={outlets}
            defaultSelected={values.restaurantIds ?? []}
            disabled={role === 'ADMIN'}
          />
        </Field>

        <Field label={values.id ? 'New password' : 'Initial password'} htmlFor="password"
          hint={values.id ? 'Leave blank to keep their current password.' : undefined}>
          <input id="password" name="password" type="text" className={inputClass} />
        </Field>

        <div className="sm:col-span-2 flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : values.id ? 'Save changes' : 'Create staff member'}
          </Button>
          <FormNote state={state} />
        </div>
      </form>
    </Card>
  )
}
