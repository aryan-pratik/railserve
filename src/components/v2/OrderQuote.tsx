'use client'

import { useActionState } from 'react'
import { Button, cx } from './ui'
import { ConfirmActionButton, Field, FormNote, checkboxV2, inputV2, type FormState } from './OrderForms'
import { Select } from './Select'
import { PACKING_CHOICES } from '@/lib/validation/order'
import { confirmEnquiryV2, markLostV2, quoteEnquiryV2 } from '@/app/v2/orders/[id]/actions'

const initial: FormState = {}

/** The dropdown in the square shape of the workspace's other fields. */
const formSelectButton = 'rounded-v2-md border-v2-line-strong'

/** Fills in what the completeness guard needs, then ENQUIRY → QUOTED. */
export function QuoteForm({
  orderId,
  outlets,
  values,
}: {
  orderId: string
  outlets: { id: string; label: string }[]
  values: { restaurantId: string; amountRupees: string; paymentMode: string; readyBy: string; contactName: string; contactPhone: string; handoverPoint: string }
}) {
  const [state, action, pending] = useActionState(quoteEnquiryV2, initial)
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="orderId" value={orderId} />
      <Field label="Outlet" htmlFor="q-restaurantId">
        <Select
          id="q-restaurantId"
          name="restaurantId"
          defaultValue={values.restaurantId}
          buttonClassName={formSelectButton}
          options={[{ value: '', label: 'Choose an outlet' }, ...outlets.map((o) => ({ value: o.id, label: o.label }))]}
        />
      </Field>
      <Field label="Quoted amount (₹)" htmlFor="q-amount">
        <input id="q-amount" name="amountRupees" inputMode="decimal" defaultValue={values.amountRupees} className={cx(inputV2, 'font-mono')} />
      </Field>
      <Field label="Payment mode" htmlFor="q-payment">
        <Select
          id="q-payment"
          name="paymentMode"
          defaultValue={values.paymentMode || 'INVOICE'}
          buttonClassName={formSelectButton}
          options={[
            { value: 'INVOICE', label: 'Invoice' },
            { value: 'PREPAID', label: 'Prepaid' },
            { value: 'COD', label: 'Cash on delivery' },
          ]}
        />
      </Field>
      <Field label="Ready by" htmlFor="q-readyBy" hint="The kitchen plans backwards from this.">
        <input id="q-readyBy" name="readyBy" type="datetime-local" defaultValue={values.readyBy} className={inputV2} />
      </Field>
      <Field label="Contact name" htmlFor="q-contactName">
        <input id="q-contactName" name="contactName" defaultValue={values.contactName} className={inputV2} />
      </Field>
      <Field label="Contact phone" htmlFor="q-contactPhone">
        <input id="q-contactPhone" name="contactPhone" defaultValue={values.contactPhone} inputMode="tel" className={cx(inputV2, 'font-mono')} />
      </Field>
      <Field label="Handover point" htmlFor="q-handover" hint="Where and to whom. For example: coach B5 door, contact Mr Sharma." className="sm:col-span-2">
        <input id="q-handover" name="handoverPoint" defaultValue={values.handoverPoint} className={inputV2} />
      </Field>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" variant="primary" disabled={pending} aria-busy={pending || undefined}>
          Save quote
        </Button>
        <FormNote state={state} />
      </div>
    </form>
  )
}

/** QUOTED → RECEIVED, adding packing lines at qty = pax. The guard fires server-side. */
export function ConfirmEnquiryForm({ orderId, alreadyPacked, missing }: { orderId: string; alreadyPacked: string[]; missing: string[] }) {
  const [state, action, pending] = useActionState(confirmEnquiryV2, initial)
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="orderId" value={orderId} />
      <div className="grid gap-1.5">
        <span className="text-xs font-semibold text-v2-ink-2">Packing</span>
        <p className="text-xs text-v2-muted">The part of a large order that gets forgotten. These print in their own KOT section.</p>
        <div className="flex flex-wrap gap-2">
          {PACKING_CHOICES.map((choice) => (
            <label
              key={choice}
              className="flex cursor-pointer items-center gap-1.5 rounded-full border border-v2-line px-2.5 py-1.5 text-sm transition-colors has-checked:border-v2-brand has-checked:bg-v2-brand-soft has-checked:text-v2-brand"
            >
              <input type="checkbox" name="packingItems" value={choice} defaultChecked={alreadyPacked.includes(choice)} className={checkboxV2} />
              {choice}
            </label>
          ))}
        </div>
      </div>
      {missing.length > 0 ? (
        <p className="rounded-v2-md bg-v2-warn-bg px-3 py-2 text-xs font-medium text-v2-warn">Still missing before this can be confirmed: {missing.join(', ')}. Save the quote above first.</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending} aria-busy={pending || undefined}>
          Confirm order
        </Button>
        <FormNote state={state} />
      </div>
    </form>
  )
}

export function MarkLostButton({ orderId, externalOrderId }: { orderId: string; externalOrderId: string }) {
  return (
    <ConfirmActionButton
      action={markLostV2}
      fields={{ orderId }}
      label="Mark lost"
      variant="danger"
      size="sm"
      title="Mark this enquiry lost?"
      description={
        <>
          <span className="font-mono font-semibold text-v2-ink">{externalOrderId}</span> closes as lost and leaves the enquiries list.
        </>
      }
      submitLabel="Mark lost"
      reason
      reasonOptional
      reasonLabel="Why (optional)"
      quickReasons={['Customer went elsewhere', 'No reply after the quote', 'Price too high', 'Date or train changed']}
    />
  )
}
