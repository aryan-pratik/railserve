'use client'

import { useActionState } from 'react'
import { saveCompany, type CompanyState } from '@/app/v2/settings/companyActions'
import { Button, Card } from './ui'
import { Field, inputClass } from './SettingsForm'
import { Notice } from './Table'

const initial: CompanyState = {}

export type CompanyValues = {
  name: string
  displayName: string
  contactPhone: string
  contactEmail: string
}

/**
 * The company's own details: its name, the name staff see in the app, and
 * how to reach it. Editable by anyone with company.manage.
 */
export function CompanyForm({ values, canEdit }: { values: CompanyValues; canEdit: boolean }) {
  const [state, action, pending] = useActionState(saveCompany, initial)
  return (
    <Card title="Company details">
      <form action={action} className="grid gap-3.5 sm:grid-cols-2">
        <Field className="content-start" label="Legal or business name" htmlFor="co-name">
          <input id="co-name" name="name" required maxLength={120} defaultValue={values.name} disabled={!canEdit} className={inputClass} />
        </Field>
        <Field className="content-start" label="Name shown in the app" htmlFor="co-display" hint="Optional. Defaults to the business name.">
          <input id="co-display" name="displayName" maxLength={120} defaultValue={values.displayName} disabled={!canEdit} className={inputClass} />
        </Field>
        <Field className="content-start" label="Contact phone" htmlFor="co-phone">
          <input id="co-phone" name="contactPhone" inputMode="tel" maxLength={20} defaultValue={values.contactPhone} disabled={!canEdit} className={inputClass} />
        </Field>
        <Field className="content-start" label="Contact email" htmlFor="co-email">
          <input id="co-email" name="contactEmail" type="email" maxLength={160} defaultValue={values.contactEmail} disabled={!canEdit} className={inputClass} />
        </Field>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? 'Saving…' : 'Save details'}
            </Button>
            {state.error ? <Notice tone="bad">{state.error}</Notice> : state.ok ? <Notice tone="ok">{state.ok}</Notice> : null}
          </div>
        ) : (
          <p className="text-sm text-v2-muted sm:col-span-2">Only people allowed to manage company settings can change these.</p>
        )}
      </form>
    </Card>
  )
}
