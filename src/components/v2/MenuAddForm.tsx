'use client'

import { useActionState } from 'react'
import { addMenuItem } from '@/app/v2/menu/actions'
import type { MenuState } from '@/app/admin/menu/actions'
import { Button, Card } from './ui'
import { Field, Input, Select } from './AnalyticsField'
import { Notice } from './Table'

const initial: MenuState = {}

/** Add a dish before its first order, so that order already prints on the right KOT. */
export function MenuAddForm({ sources }: { sources: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState(addMenuItem, initial)
  return (
    <Card title="Add a dish">
      <p className="-mt-2 text-sm text-v2-muted">
        For a dish you know is coming before its first order. Adding a deleted dish again puts it back with the tag you pick.
      </p>
      <form action={action} className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_minmax(0,10rem)_auto] sm:items-end">
        <Field label="Aggregator">
          <Select name="source" defaultValue="" placeholder="Pick one" aria-label="Aggregator" options={sources.map((s) => ({ value: s.id, label: s.label }))} />
        </Field>
        <Field label="Dish">
          <Input name="name" required maxLength={200} placeholder="As the aggregator writes it" autoComplete="off" />
        </Field>
        <Field label="Veg / non-veg">
          <Select
            name="diet"
            defaultValue=""
            placeholder="Pick one"
            aria-label="Veg / non-veg"
            options={[
              { value: 'VEG', label: 'Veg' },
              { value: 'NON_VEG', label: 'Non-veg' },
            ]}
          />
        </Field>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Adding…' : 'Add'}
        </Button>
        {state.error ? (
          <Notice tone="bad" className="sm:col-span-4">
            {state.error}
          </Notice>
        ) : state.ok ? (
          <Notice tone="ok" className="sm:col-span-4">
            {state.ok}
          </Notice>
        ) : null}
      </form>
    </Card>
  )
}
