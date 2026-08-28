'use client'

import { useActionState } from 'react'
import { Button, Card, CardHeader, Field, FormNote, inputClass } from '@/components/ui'
import { PACKING_CHOICES } from '@/lib/validation/order'
import { confirmEnquiryAction, quoteEnquiryAction, type EnquiryState } from '../actions'

const initial: EnquiryState = {}

export function QuoteForm({
  orderId, outlets, values,
}: {
  orderId: string
  outlets: { id: string; label: string }[]
  values: {
    restaurantId: string
    amountRupees: string
    paymentMode: string
    readyBy: string
    contactName: string
    contactPhone: string
    handoverPoint: string
  }
}) {
  const [state, action, pending] = useActionState(quoteEnquiryAction, initial)

  return (
    <Card>
      <CardHeader title="Quote" />
      <form action={action} className="grid gap-4 p-4 sm:grid-cols-2">
        <input type="hidden" name="orderId" value={orderId} />

        <Field label="Outlet" htmlFor="restaurantId">
          <select id="restaurantId" name="restaurantId" defaultValue={values.restaurantId} className={inputClass}>
            <option value="">Choose an outlet…</option>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Quoted amount (₹)" htmlFor="amountRupees">
          <input id="amountRupees" name="amountRupees" inputMode="decimal"
            defaultValue={values.amountRupees} className={`${inputClass} tabular-nums`} />
        </Field>

        <Field label="Payment mode" htmlFor="paymentMode">
          <select id="paymentMode" name="paymentMode" defaultValue={values.paymentMode || 'INVOICE'} className={inputClass}>
            <option value="INVOICE">Invoice</option>
            <option value="PREPAID">Prepaid</option>
            <option value="COD">Cash on delivery</option>
          </select>
        </Field>

        <Field label="Ready by" htmlFor="readyBy" hint="The kitchen plans backwards from this.">
          <input id="readyBy" name="readyBy" type="datetime-local"
            defaultValue={values.readyBy} className={inputClass} />
        </Field>

        <Field label="Contact name" htmlFor="contactName">
          <input id="contactName" name="contactName" defaultValue={values.contactName} className={inputClass} />
        </Field>

        <Field label="Contact phone" htmlFor="contactPhone">
          <input id="contactPhone" name="contactPhone" defaultValue={values.contactPhone}
            className={`${inputClass} font-mono tabular-nums`} />
        </Field>

        <div className="sm:col-span-2">
          <Field label="Handover point" htmlFor="handoverPoint"
            hint="Where and to whom, e.g. “coach B5 door, contact Mr Sharma”.">
            <input id="handoverPoint" name="handoverPoint" defaultValue={values.handoverPoint} className={inputClass} />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save quote'}
          </Button>
          <FormNote state={state} />
        </div>
      </form>
    </Card>
  )
}

export function ConfirmForm({
  orderId, alreadyPacked,
}: {
  orderId: string
  alreadyPacked: string[]
}) {
  const [state, action, pending] = useActionState(confirmEnquiryAction, initial)

  return (
    <Card>
      <CardHeader title="Confirm" />
      <form action={action} className="space-y-4 p-4">
        <input type="hidden" name="orderId" value={orderId} />

        <div>
          <span className="mb-1 block text-sm font-medium text-ink">Packing</span>
          <p className="mb-2 text-xs text-muted">
            The part of a large order that gets forgotten. These print in their own KOT section.
          </p>
          <div className="flex flex-wrap gap-2">
            {PACKING_CHOICES.map((choice) => (
              <label
                key={choice}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-sunken/60 px-2.5 py-1.5 text-sm text-ink transition hover:border-line-strong"
              >
                <input type="checkbox" name="packingItems" value={choice}
                  defaultChecked={alreadyPacked.includes(choice)}
                  className="rounded border-line-strong accent-accent" />
                {choice}
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="go" disabled={pending}>
            {pending ? 'Confirming…' : 'Confirm order'}
          </Button>
          <span className="text-xs text-muted">
            Refused unless outlet, phone, amount, payment mode and ready-by are all set.
          </span>
        </div>

        <FormNote state={state} />
      </form>
    </Card>
  )
}
