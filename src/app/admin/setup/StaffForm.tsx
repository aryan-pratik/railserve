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
  canCollectReturns?: boolean
  isTeamLead?: boolean
  teamLeadId?: string | null
  /** Null when nobody has decided: a manager then may, a team leader may not. */
  canReceiveCash?: boolean | null
}

/**
 * "Rider team leader" is offered as a role because that is how the office
 * thinks of it. Underneath, a team leader is a rider with a mark on them
 * (see User.isTeamLead), so they keep the rider app and their own orders.
 */
const TEAM_LEAD = 'RIDER_TEAM_LEAD'

export function StaffForm({
  outlets, values = {}, onSaved, lockedRole, teamLeads,
}: {
  outlets: OutletOption[]
  /** Active team leaders a rider can be placed under. Admin screens only. */
  teamLeads?: { id: string; name: string }[]
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
  const [choice, setChoice] = useState(
    lockedRole ?? (values.role === 'DELIVERY_AGENT' && values.isTeamLead ? TEAM_LEAD : values.role) ?? 'STORE_MANAGER',
  )
  const isLead = choice === TEAM_LEAD
  const role = isLead ? 'DELIVERY_AGENT' : choice

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
              <input type="hidden" name="role" value={role} />
              {isLead ? <input type="hidden" name="isTeamLead" value="true" /> : null}
              <select id="role" value={choice} onChange={(e) => setChoice(e.target.value)}
                className={inputClass}>
                <option value="STORE_MANAGER">Store manager</option>
                <option value="DELIVERY_AGENT">Rider</option>
                <option value={TEAM_LEAD}>Rider team leader</option>
                <option value="TELECALLER">Telecaller</option>
                <option value="ADMIN">Admin</option>
              </select>
            </Field>
          )}

          {/* Per manager, not per role: one manager owns the counter a bag
              comes back to. Hidden off the manager role, and never offered
              where the role is locked (the store's own Riders page). */}
          {!lockedRole && role === 'STORE_MANAGER' ? (
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line px-3 py-2.5 hover:bg-sunken">
              <input
                type="checkbox"
                name="canCollectReturns"
                value="true"
                defaultChecked={values.canCollectReturns ?? false}
                className="mt-0.5 size-4 accent-accent"
              />
              <span>
                <span className="block text-sm font-medium text-ink">Can collect returns (RTO)</span>
                <span className="block text-xs text-muted">
                  May mark an order as back at the counter when a rider brings it back cancelled or undelivered.
                </span>
              </span>
            </label>
          ) : null}

          {!lockedRole && role === 'DELIVERY_AGENT' && !isLead ? (
            <Field label="Team leader" htmlFor="teamLeadId" hint="Their team leader sees their orders, deliveries and cash in the rider app.">
              <select id="teamLeadId" name="teamLeadId" defaultValue={values.teamLeadId ?? ''} className={inputClass}>
                <option value="">No team</option>
                {(teamLeads ?? []).filter((l) => l.id !== values.id).map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </Field>
          ) : null}

          {/* Who may mark a rider's cash as received is decided per person.
              A manager is ticked unless an admin unticks them; a team leader
              is not, until an admin ticks them. Keyed so the default follows
              the role picked. */}
          {!lockedRole && (role === 'STORE_MANAGER' || isLead) ? (
            <label key={choice} className="flex cursor-pointer items-start gap-3 rounded-lg border border-line px-3 py-2.5 hover:bg-sunken">
              <input
                type="checkbox"
                name="canReceiveCash"
                value="true"
                defaultChecked={values.canReceiveCash ?? role === 'STORE_MANAGER'}
                className="mt-0.5 size-4 accent-accent"
              />
              <span>
                <span className="block text-sm font-medium text-ink">Can receive COD cash from riders</span>
                <span className="block text-xs text-muted">
                  {isLead
                    ? 'May mark the cash of riders on their own team as received.'
                    : 'May mark a rider’s cash as received at the counter. An admin always can.'}
                </span>
              </span>
            </label>
          ) : null}

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
                  : 'Riders see only orders at the outlets they are attached to, and can only be assigned those. Without one, their app is empty.'
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
