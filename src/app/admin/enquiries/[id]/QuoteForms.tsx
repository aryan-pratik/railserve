'use client'

import { useActionState } from 'react'
import { Card, CardHeader, Field, inputClass } from '@/components/ui'
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
            defaultValue={values.amountRupees} className={inputClass} />
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
          <input id="contactPhone" name="contactPhone" defaultValue={values.contactPhone} className={inputClass} />
        </Field>

        <div className="sm:col-span-2">
          <Field label="Handover point" htmlFor="handoverPoint"
            hint="Where and to whom, e.g. “coach B5 door, contact Mr Sharma”.">
            <input id="handoverPoint" name="handoverPoint" defaultValue={values.handoverPoint} className={inputClass} />
          </Field>
        </div>

        <div className="flex items-center gap-3 sm:col-span-2">
          <button type="submit" disabled={pending}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60">
            {pending ? 'Saving…' : 'Save quote'}
          </button>
          {state.error ? <span className="text-sm font-medium text-red-600">{state.error}</span> : null}
          {state.ok ? <span className="text-sm font-medium text-emerald-700">{state.ok}</span> : null}
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
          <span className="mb-1 block text-sm font-medium text-slate-700">Packing</span>
          <p className="mb-2 text-xs text-slate-500">
            The part of a large order that gets forgotten. These print in their own KOT section.
          </p>
          <div className="flex flex-wrap gap-3">
            {PACKING_CHOICES.map((choice) => (
              <label key={choice} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" name="packingItems" value={choice}
                  defaultChecked={alreadyPacked.includes(choice)}
                  className="rounded border-slate-300" />
                {choice}
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
            {pending ? 'Confirming…' : 'Confirm order'}
          </button>
          <span className="text-xs text-slate-500">
            Refused unless outlet, phone, amount, payment mode and ready-by are all set.
          </span>
        </div>

        {state.error ? <p className="text-sm font-medium text-red-600">{state.error}</p> : null}
        {state.ok ? <p className="text-sm font-medium text-emerald-700">{state.ok}</p> : null}
      </form>
    </Card>
  )
}
