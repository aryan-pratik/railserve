'use client'

import { useActionState, useEffect, useState } from 'react'
import { Pencil, Plus } from 'lucide-react'
import { Button, cx, v2Focus } from './ui'
import { SettingsDialog } from './SettingsDialog'
import { Field, FormNote, inputClass, textareaClass } from './SettingsForm'
import { saveOutlet, type RestaurantState } from '@/app/v2/settings/actions'

export type OutletFormValues = {
  id?: string
  name?: string
  stationCode?: string
  stationName?: string | null
  aliases?: string[]
  contactName?: string | null
  contactPhone?: string | null
  walkToPlatformMinutes?: number
}

const initial: RestaurantState = {}

/**
 * New and Edit share one dialog; `values.id` decides which. v1 had no edit at
 * all, although the action always accepted an id.
 */
export function SettingsOutletDialog({
  values,
  stations,
}: {
  values?: OutletFormValues
  /** Station codes already served, for the datalist. Any code is still accepted. */
  stations: { code: string; name: string | null }[]
}) {
  const [open, setOpen] = useState(false)
  const editing = Boolean(values?.id)
  const titleId = `outlet-dialog-${values?.id ?? 'new'}`

  return (
    <>
      {editing ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Edit ${values?.name ?? 'outlet'}`}
          title="Edit"
          className={cx('grid h-8 w-8 place-items-center rounded-full text-v2-muted transition-colors hover:bg-v2-surface-2 hover:text-v2-ink', v2Focus)}
        >
          <Pencil size={15} aria-hidden />
        </button>
      ) : (
        <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
          <Plus size={15} strokeWidth={2.4} aria-hidden />
          New outlet
        </Button>
      )}
      {open ? (
        <SettingsDialog title={editing ? `Edit ${values?.name}` : 'New outlet'} titleId={titleId} onClose={() => setOpen(false)}>
          <OutletForm values={values} stations={stations} onSaved={() => setOpen(false)} />
        </SettingsDialog>
      ) : null}
    </>
  )
}

function OutletForm({
  values = {},
  stations,
  onSaved,
}: {
  values?: OutletFormValues
  stations: { code: string; name: string | null }[]
  onSaved: () => void
}) {
  const [state, action, pending] = useActionState(saveOutlet, initial)
  const id = values.id ?? 'new'

  useEffect(() => {
    if (state.ok) onSaved()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok])

  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

      <Field label="Outlet name" htmlFor={`name-${id}`} className="sm:col-span-2">
        <input id={`name-${id}`} name="name" required defaultValue={values.name} placeholder="HOTEL GANGA GALAXY" className={inputClass} />
      </Field>

      <Field label="Station code" htmlFor={`station-${id}`}>
        <input
          id={`station-${id}`}
          name="stationCode"
          required
          list={`stations-${id}`}
          defaultValue={values.stationCode}
          placeholder="CNB"
          autoCapitalize="characters"
          spellCheck={false}
          className={cx(inputClass, 'font-mono uppercase')}
        />
        <datalist id={`stations-${id}`}>
          {stations.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name ?? s.code}
            </option>
          ))}
        </datalist>
      </Field>

      <Field label="Station name" htmlFor={`stationName-${id}`}>
        <input id={`stationName-${id}`} name="stationName" defaultValue={values.stationName ?? ''} placeholder="KANPUR CENTRAL" className={inputClass} />
      </Field>

      <Field label="Walk to platform" htmlFor={`walk-${id}`} hint="Minutes from the counter to the platform; sets when a bag must leave.">
        <input
          id={`walk-${id}`}
          name="walkToPlatformMinutes"
          type="number"
          min={0}
          max={120}
          defaultValue={values.walkToPlatformMinutes ?? 10}
          className={cx(inputClass, 'font-mono')}
        />
      </Field>

      <Field label="Contact name" htmlFor={`contactName-${id}`}>
        <input id={`contactName-${id}`} name="contactName" defaultValue={values.contactName ?? ''} className={inputClass} />
      </Field>

      <Field label="Contact phone" htmlFor={`contactPhone-${id}`} className="sm:col-span-2">
        <input id={`contactPhone-${id}`} name="contactPhone" defaultValue={values.contactPhone ?? ''} inputMode="tel" autoComplete="off" className={cx(inputClass, 'font-mono')} />
      </Field>

      <Field
        label="Name aliases"
        htmlFor={`aliases-${id}`}
        className="sm:col-span-2"
        hint="One per line or comma separated. Aggregator mail spells outlet names inconsistently; these are how a mail is matched to this kitchen."
      >
        <textarea id={`aliases-${id}`} name="aliases" rows={3} defaultValue={(values.aliases ?? []).join('\n')} className={textareaClass} />
      </Field>

      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Saving…' : values.id ? 'Save changes' : 'Create outlet'}
        </Button>
        <FormNote state={state} />
      </div>
    </form>
  )
}
