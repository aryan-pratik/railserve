'use client'

import { useActionState } from 'react'
import { Button, Card, CardHeader, Field, FormNote, inputClass } from '@/components/ui'
import { saveRestaurant, type RestaurantState } from './outletActions'

const initial: RestaurantState = {}

export type OutletValues = {
  id?: string
  name?: string
  stationCode?: string
  stationName?: string
  aliases?: string
  contactName?: string
  contactPhone?: string
  walkToPlatformMinutes?: number
}

export function OutletForm({ values = {} }: { values?: OutletValues }) {
  const [state, action, pending] = useActionState(saveRestaurant, initial)

  return (
    <Card>
      <CardHeader title={values.id ? 'Edit outlet' : 'New outlet'} />
      <form action={action} className="grid gap-4 p-4 sm:grid-cols-2">
        {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

        <Field label="Outlet name" htmlFor="name">
          <input id="name" name="name" required defaultValue={values.name}
            placeholder="HOTEL GANGA GALAXY" className={inputClass} />
        </Field>

        <Field label="Station code" htmlFor="stationCode">
          <input id="stationCode" name="stationCode" required defaultValue={values.stationCode}
            placeholder="CNB" className={`${inputClass} uppercase`} />
        </Field>

        <Field label="Station name" htmlFor="stationName">
          <input id="stationName" name="stationName" defaultValue={values.stationName}
            placeholder="KANPUR CENTRAL" className={inputClass} />
        </Field>

        <Field label="Walk to platform (minutes)" htmlFor="walkToPlatformMinutes"
          hint="Used to compute dispatch timing later.">
          <input id="walkToPlatformMinutes" name="walkToPlatformMinutes" type="number" min={0}
            defaultValue={values.walkToPlatformMinutes ?? 10} className={inputClass} />
        </Field>

        <Field label="Contact name" htmlFor="contactName">
          <input id="contactName" name="contactName" defaultValue={values.contactName}
            className={inputClass} />
        </Field>

        <Field label="Contact phone" htmlFor="contactPhone">
          <input id="contactPhone" name="contactPhone" defaultValue={values.contactPhone}
            className={inputClass} />
        </Field>

        <div className="sm:col-span-2">
          <Field label="Name aliases" htmlFor="aliases"
            hint="One per line, or comma separated. Aggregator emails spell outlet names inconsistently; these are how an email will be matched to this kitchen.">
            <textarea id="aliases" name="aliases" rows={3} defaultValue={values.aliases}
              className={inputClass} />
          </Field>
        </div>

        <div className="sm:col-span-2 flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : values.id ? 'Save changes' : 'Create outlet'}
          </Button>
          <FormNote state={state} />
        </div>
      </form>
    </Card>
  )
}
