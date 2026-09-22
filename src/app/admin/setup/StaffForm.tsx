'use client'

import { useActionState, useEffect, useState } from 'react'
import { Button, Field, FormNote, inputClass } from '@/components/ui'
import { saveUser, type UserState } from './staffActions'
import { OutletMultiSelect, type OutletOption } from './OutletMultiSelect'
import { ROLE_LABEL, type Role } from '@/lib/roles'

const initial: UserState = {}

export type StaffValues = {
  id?: string
  name?: string
  phone?: string
  role?: string
  restaurantIds?: string[]
}

export function StaffForm({
  outlets, values = {}, onSaved, lockedRole,
}: {
  outlets: OutletOption[]
  values?: StaffValues
  onSaved?: () => void
  /**
   * Locks the role field to one value and hides the picker — used by the
   * store manager's Riders page, which may only ever create DELIVERY_AGENT
   * staff. Seeded into local `role` state (still needed by the outlet
   * picker's subtitle/disabled logic below) but never changed by the user.
   */
  lockedRole?: Role
}) {
  const [state, action, pending] = useActionState(saveUser, initial)
  const [role, setRole] = useState(lockedRole ?? values.role ?? 'STORE_MANAGER')

  useEffect(() => {
    if (state.ok) onSaved?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok])

  return (
    <form action={action} className="p-4">
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="name">
              <input id="name" name="name" required defaultValue={values.name} className={inputClass} />
            </Field>

            <Field label="Phone" htmlFor="phone" hint="This is their login identifier.">
              <input id="phone" name="phone" required inputMode="tel" autoComplete="off" defaultValue={values.phone}
                className={`${inputClass} font-mono`} />
            </Field>
          </div>

          {lockedRole ? (
            <Field label="Role" htmlFor="role">
              <input type="hidden" name="role" value={lockedRole} />
              <div className={`${inputClass} bg-sunken text-muted`}>{ROLE_LABEL[lockedRole]}</div>
            </Field>
          ) : (
            <Field label="Role" htmlFor="role">
              <select id="role" name="role" value={role} onChange={(e) => setRole(e.target.value)}
                className={inputClass}>
                <option value="STORE_MANAGER">Store manager</option>
                <option value="DELIVERY_AGENT">Delivery agent</option>
                <option value="TELECALLER">Telecaller</option>
                <option value="ADMIN">Admin</option>
              </select>
            </Field>
          )}

          <Field label={values.id ? 'New password' : 'Initial password'} htmlFor="password"
            hint={values.id ? 'Leave blank to keep their current password.' : undefined}>
            <input id="password" name="password" type="text" autoComplete="off" spellCheck={false} className={inputClass} />
          </Field>
        </div>

        <OutletMultiSelect
          name="restaurantIds"
          options={outlets}
          defaultSelected={values.restaurantIds ?? []}
          disabled={role === 'ADMIN'}
          subtitle={
            role === 'ADMIN'
              ? 'Not needed for an admin.'
              : role === 'STORE_MANAGER'
                ? 'Every outlet this manager runs. They all share one board.'
                : role === 'TELECALLER'
                  ? 'The outlets whose orders this telecaller may call about and cancel. Nothing outside them is visible to them at all.'
                  : 'Riders see the live runs of the outlets they are attached to. Without one, their app is empty.'
          }
        />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button type="submit" pending={pending}>
          {values.id ? 'Save changes' : 'Create staff member'}
        </Button>
        <FormNote state={state} />
      </div>
    </form>
  )
}
