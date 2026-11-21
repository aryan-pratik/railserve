'use client'

import { useActionState, useEffect, useState } from 'react'
import { saveRiderV2 } from '@/app/v2/riders/actions'
import type { UserState } from '@/app/admin/setup/staffActions'
import type { OutletChoice } from '@/lib/v2/riders'
import { Button, cx } from './ui'
import { RiderDialog, RiderField, RiderFormNote, riderInputClass } from './RiderDialog'
import { Select } from './Select'

const initial: UserState = {}

export type RiderFormValues = {
  id?: string
  name?: string
  phone?: string
  outletIds?: string[]
  isTeamLead?: boolean
  teamLeadId?: string | null
  canReceiveCash?: boolean | null
}

/**
 * Add or edit a rider. Posts to `saveUser` with the role pinned to rider, so
 * a store manager can only ever make riders at their own outlets (the action
 * checks the same thing server-side). The team fields are an admin's: a
 * manager's post leaves them out and what the admin set stays.
 */
export function RiderFormDialog({
  values = {},
  outlets,
  teamLeads,
  isAdmin,
  onClose,
  onSaved,
}: {
  values?: RiderFormValues
  outlets: OutletChoice[]
  teamLeads: { id: string; name: string }[]
  isAdmin: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [state, action, pending] = useActionState(saveRiderV2, initial)
  const [lead, setLead] = useState(values.isTeamLead ?? false)
  const editing = Boolean(values.id)

  useEffect(() => {
    if (state.ok) onSaved()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok])

  const stations = [...new Set(outlets.map((o) => o.station))]

  return (
    <RiderDialog
      title={editing ? `Edit ${values.name ?? 'rider'}` : 'Add rider'}
      titleId="rider-form-dialog"
      note={editing ? 'Phone is their login. Leave the password blank to keep it.' : 'They sign in to the rider app with this phone and password.'}
      onClose={onClose}
      width="max-w-xl"
      footer={
        <>
          <RiderFormNote state={state} className="mr-auto" />
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="rider-form" variant="primary" disabled={pending}>
            {pending ? 'Saving…' : editing ? 'Save changes' : 'Create rider'}
          </Button>
        </>
      }
    >
      <form id="rider-form" action={action} className="grid gap-4">
        {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
        <input type="hidden" name="role" value="DELIVERY_AGENT" />

        <div className="grid gap-4 sm:grid-cols-2">
          <RiderField label="Name" htmlFor="rider-name">
            <input id="rider-name" name="name" required defaultValue={values.name} autoComplete="off" className={riderInputClass} />
          </RiderField>
          <RiderField label="Phone" htmlFor="rider-phone">
            <input
              id="rider-phone"
              name="phone"
              required
              inputMode="tel"
              autoComplete="off"
              defaultValue={values.phone}
              className={cx(riderInputClass, 'font-mono tabular-nums')}
            />
          </RiderField>
        </div>

        <fieldset className="grid gap-2">
          <legend className="text-[12.5px] font-semibold text-v2-ink-2">Outlets</legend>
          <p className="-mt-1 text-xs text-v2-muted">Riders see only orders at the outlets they are attached to. Without one, their app is empty.</p>
          {outlets.length === 0 ? (
            <p className="text-sm text-v2-muted">No outlets to choose from.</p>
          ) : (
            <div className="grid gap-3 rounded-v2-md border border-v2-line p-3 sm:grid-cols-2">
              {stations.map((station) => (
                <div key={station} className="grid content-start gap-1">
                  <span className="font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-v2-muted">{station}</span>
                  {outlets
                    .filter((o) => o.station === station)
                    .map((o) => (
                      <label key={o.id} className="flex cursor-pointer items-center gap-2.5 rounded-v2-sm px-1.5 py-1 text-sm hover:bg-v2-surface-2">
                        <input
                          type="checkbox"
                          name="restaurantIds"
                          value={o.id}
                          defaultChecked={values.outletIds?.includes(o.id) ?? false}
                          className="h-4 w-4 rounded border-v2-line-strong accent-v2-brand"
                        />
                        <span className="truncate">{o.label.replace(` · ${o.station}`, '')}</span>
                      </label>
                    ))}
                </div>
              ))}
            </div>
          )}
        </fieldset>

        {isAdmin ? (
          <div className="grid gap-3 rounded-v2-md border border-v2-line p-3">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                name="isTeamLead"
                value="true"
                checked={lead}
                onChange={(e) => setLead(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-v2-line-strong accent-v2-brand"
              />
              <span>
                <span className="block text-sm font-semibold">Team leader</span>
                <span className="block text-xs text-v2-muted">Sees their team&apos;s orders, deliveries and cash in the rider app. Keeps their own runs.</span>
              </span>
            </label>
            {lead ? (
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  name="canReceiveCash"
                  value="true"
                  defaultChecked={values.canReceiveCash === true}
                  className="mt-0.5 h-4 w-4 rounded border-v2-line-strong accent-v2-brand"
                />
                <span>
                  <span className="block text-sm font-semibold">Can receive COD cash from their team</span>
                  <span className="block text-xs text-v2-muted">May mark the cash of riders on their own team as received.</span>
                </span>
              </label>
            ) : (
              <RiderField label="Reports to" htmlFor="rider-lead" hint="Their team leader. A team is one level deep.">
                <Select
                  id="rider-lead"
                  name="teamLeadId"
                  defaultValue={values.teamLeadId ?? ''}
                  buttonClassName="rounded-v2-md border-v2-line-strong"
                  options={[{ value: '', label: 'No team' }, ...teamLeads.filter((l) => l.id !== values.id).map((l) => ({ value: l.id, label: l.name }))]}
                />
              </RiderField>
            )}
          </div>
        ) : null}

        <RiderField label={editing ? 'New password' : 'Initial password'} htmlFor="rider-password" hint={editing ? 'Leave blank to keep their current password.' : undefined}>
          <input
            id="rider-password"
            name="password"
            type="password"
            autoComplete="new-password"
            required={!editing}
            minLength={4}
            className={riderInputClass}
          />
        </RiderField>
      </form>
    </RiderDialog>
  )
}
