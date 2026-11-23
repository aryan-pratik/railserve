'use client'

import { useActionState, useEffect, useMemo, useState } from 'react'
import { Pencil, Plus } from 'lucide-react'
import { Button, cx, v2Focus } from './ui'
import { SettingsDialog } from './SettingsDialog'
import { CheckRow, Field, FormNote, checkboxClass, inputClass } from './SettingsForm'
import { Select } from './Select'
import { saveStaff, type UserState } from '@/app/v2/settings/actions'
import { pagesFor } from '@/lib/pageAccess'
import type { Role } from '@/lib/roles'

export type StaffFormValues = {
  id?: string
  name?: string
  phone?: string
  role?: string
  restaurantIds?: string[]
  canCollectReturns?: boolean
  hiddenPages?: string[]
  isTeamLead?: boolean
  teamLeadId?: string | null
  /** Null when nobody has decided: a manager then may, a team leader may not. */
  canReceiveCash?: boolean | null
}

export type OutletOption = { id: string; name: string; stationCode: string; stationName: string | null }

const initial: UserState = {}

/**
 * "Rider team leader" is offered as a role because that is how the office
 * thinks of it. Underneath it is a rider with `isTeamLead` set (see the User
 * model), so they keep the rider app and their own orders.
 */
const TEAM_LEAD = 'RIDER_TEAM_LEAD'

/** The dropdown in the square shape of the dialog's other fields. */
const dialogSelectButton = 'rounded-v2-md border-v2-line-strong'

export function SettingsStaffDialog({
  values,
  outlets,
  teamLeads,
}: {
  values?: StaffFormValues
  outlets: OutletOption[]
  teamLeads: { id: string; name: string }[]
}) {
  const [open, setOpen] = useState(false)
  const editing = Boolean(values?.id)
  const titleId = `staff-dialog-${values?.id ?? 'new'}`

  return (
    <>
      {editing ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Edit ${values?.name ?? 'staff member'}`}
          title="Edit"
          className={cx('grid h-8 w-8 place-items-center rounded-full text-v2-muted transition-colors hover:bg-v2-surface-2 hover:text-v2-ink', v2Focus)}
        >
          <Pencil size={15} aria-hidden />
        </button>
      ) : (
        <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
          <Plus size={15} strokeWidth={2.4} aria-hidden />
          Add staff
        </Button>
      )}
      {open ? (
        <SettingsDialog width="lg" title={editing ? `Edit ${values?.name}` : 'Add staff'} titleId={titleId} onClose={() => setOpen(false)}>
          <StaffForm values={values} outlets={outlets} teamLeads={teamLeads} onSaved={() => setOpen(false)} />
        </SettingsDialog>
      ) : null}
    </>
  )
}

function StaffForm({
  values = {},
  outlets,
  teamLeads,
  onSaved,
}: {
  values?: StaffFormValues
  outlets: OutletOption[]
  teamLeads: { id: string; name: string }[]
  onSaved: () => void
}) {
  const [state, action, pending] = useActionState(saveStaff, initial)
  const [choice, setChoice] = useState((values.role === 'DELIVERY_AGENT' && values.isTeamLead ? TEAM_LEAD : values.role) ?? 'STORE_MANAGER')
  const isLead = choice === TEAM_LEAD
  const role = isLead ? 'DELIVERY_AGENT' : choice
  const id = values.id ?? 'new'

  useEffect(() => {
    if (state.ok) onSaved()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok])

  const outletNote =
    role === 'ADMIN'
      ? 'An admin sees every outlet and holds none.'
      : role === 'STORE_MANAGER'
        ? 'Every outlet this manager runs. They all share one board.'
        : role === 'TELECALLER'
          ? 'The outlets whose orders this telecaller may call about and cancel.'
          : 'Riders see only orders at the outlets they are attached to. Without one, their app is empty.'

  return (
    <form action={action} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <input type="hidden" name="role" value={role} />
      {isLead ? <input type="hidden" name="isTeamLead" value="true" /> : null}

      <div className="grid content-start gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor={`name-${id}`}>
            <input id={`name-${id}`} name="name" required defaultValue={values.name} className={inputClass} />
          </Field>
          <Field label="Phone" htmlFor={`phone-${id}`} hint="Their login.">
            <input id={`phone-${id}`} name="phone" required inputMode="tel" autoComplete="off" defaultValue={values.phone} className={cx(inputClass, 'font-mono')} />
          </Field>
        </div>

        <Field label="Role" htmlFor={`role-${id}`}>
          <Select
            id={`role-${id}`}
            value={choice}
            onChange={setChoice}
            buttonClassName={dialogSelectButton}
            options={[
              { value: 'STORE_MANAGER', label: 'Store manager' },
              { value: 'DELIVERY_AGENT', label: 'Rider' },
              { value: TEAM_LEAD, label: 'Rider team leader' },
              { value: 'TELECALLER', label: 'Telecaller' },
              { value: 'ADMIN', label: 'Admin' },
            ]}
          />
        </Field>

        {role === 'STORE_MANAGER' ? (
          <CheckRow
            name="canCollectReturns"
            title="Can collect returns"
            note="May mark an order as back at the counter when a rider brings it back cancelled or undelivered."
            defaultChecked={values.canCollectReturns ?? false}
          />
        ) : null}

        {pagesFor(role as Role).length ? (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-[14px] font-semibold">Pages they can open</legend>
            <p className="-mt-1 text-[12.5px] text-v2-muted">
              {role === 'STORE_MANAGER' ? 'Kitchen is always on.' : 'Calls to make is always on.'} A page you untick is gone from their menu, and its address takes them back home.
            </p>
            {/* Tells the save that the boxes were on the form, so none ticked means all off. */}
            <input type="hidden" name="pagesShown" value="1" />
            {pagesFor(role as Role).map((p) => (
              <CheckRow key={p.key} name="pages" value={p.key} title={p.label} defaultChecked={!(values.hiddenPages ?? []).includes(p.key)} />
            ))}
          </fieldset>
        ) : null}

        {role === 'DELIVERY_AGENT' && !isLead ? (
          <Field label="Team leader" htmlFor={`lead-${id}`} hint="Their leader sees their orders, deliveries and cash in the rider app.">
            <Select
              id={`lead-${id}`}
              name="teamLeadId"
              defaultValue={values.teamLeadId ?? ''}
              buttonClassName={dialogSelectButton}
              options={[{ value: '', label: 'No team' }, ...teamLeads.filter((l) => l.id !== values.id).map((l) => ({ value: l.id, label: l.name }))]}
            />
          </Field>
        ) : null}

        {/* Keyed on the choice so the default follows the role picked: a
            manager is ticked unless an admin unticks them; a leader is not
            until an admin ticks them. */}
        {role === 'STORE_MANAGER' || isLead ? (
          <div key={choice}>
            <CheckRow
              name="canReceiveCash"
              title="Can receive COD cash from riders"
              note={isLead ? 'May mark the cash of riders on their own team as received.' : 'May mark a rider’s cash as received at the counter. An admin always can.'}
              defaultChecked={values.canReceiveCash ?? role === 'STORE_MANAGER'}
            />
          </div>
        ) : null}

        <Field label={values.id ? 'New password' : 'Initial password'} htmlFor={`password-${id}`} hint={values.id ? 'Leave blank to keep their current password.' : undefined}>
          <input id={`password-${id}`} name="password" type="password" autoComplete="new-password" required={!values.id} className={inputClass} />
        </Field>
      </div>

      <OutletPicker name="restaurantIds" options={outlets} defaultSelected={values.restaurantIds ?? []} disabled={role === 'ADMIN'} note={outletNote} />

      <div className="flex flex-wrap items-center gap-3 lg:col-span-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Saving…' : values.id ? 'Save changes' : 'Create staff member'}
        </Button>
        <FormNote state={state} />
      </div>
    </form>
  )
}

/**
 * Outlets grouped by station, each group with its own select-all. An embedded
 * panel with its own scroll rather than a popover, so it can never escape the
 * dialog. Real checkboxes carry the values; the admin case renders none, so
 * the form posts no outlets for a role that holds none.
 */
function OutletPicker({
  name,
  options,
  defaultSelected,
  disabled,
  note,
}: {
  name: string
  options: OutletOption[]
  defaultSelected: string[]
  disabled: boolean
  note: string
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(defaultSelected))
  const groups = useMemo(() => {
    const map = new Map<string, OutletOption[]>()
    for (const o of options) {
      const list = map.get(o.stationCode) ?? []
      list.push(o)
      map.set(o.stationCode, list)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [options])

  const toggle = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })

  return (
    <fieldset disabled={disabled} className={cx('grid min-w-0 content-start gap-2 rounded-v2-md border border-v2-line p-3', disabled && 'bg-v2-surface-2')}>
      <legend className="sr-only">Outlets</legend>
      <div>
        <div className="text-[12.5px] font-semibold text-v2-ink-2">Outlets</div>
        <p className="text-xs text-v2-muted">{note}</p>
      </div>
      {disabled ? null : (
        <div className="grid max-h-72 gap-2 overflow-y-auto pr-1">
          {groups.map(([code, list]) => {
            const on = list.filter((o) => selected.has(o.id)).length
            return (
              <div key={code} className="rounded-v2-md border border-v2-line">
                <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-v2-surface-2">
                  <input
                    type="checkbox"
                    checked={on === list.length}
                    ref={(el) => {
                      if (el) el.indeterminate = on > 0 && on < list.length
                    }}
                    onChange={(e) => toggle(list.map((o) => o.id), e.target.checked)}
                    className={checkboxClass}
                    aria-label={`Select all outlets at ${code}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      <span className="font-mono">{code}</span>
                      {list[0]?.stationName ? <span className="text-v2-muted"> · {list[0].stationName}</span> : null}
                    </span>
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-v2-muted">
                    {on}/{list.length}
                  </span>
                </label>
                <div className="border-t border-v2-line">
                  {list.map((o) => (
                    <label key={o.id} className="flex cursor-pointer items-center gap-2.5 py-1.5 pl-9 pr-3 text-sm hover:bg-v2-surface-2">
                      <input type="checkbox" name={name} value={o.id} checked={selected.has(o.id)} onChange={(e) => toggle([o.id], e.target.checked)} className={checkboxClass} />
                      <span className="truncate">{o.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )
          })}
          {groups.length === 0 ? <p className="py-6 text-center text-sm text-v2-muted">No outlets yet. Create one under Outlets first.</p> : null}
        </div>
      )}
    </fieldset>
  )
}
