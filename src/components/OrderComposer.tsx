'use client'

import { useActionState, useState } from 'react'
import { Button, Card, CardHeader, Field, FormNote, inputClass } from '@/components/ui'
import { PACKING_CHOICES } from '@/lib/validation/order'

export type ComposerState = { error?: string; ok?: string }

export type Outlet = { id: string; label: string }

const initial: ComposerState = {}

/**
 * Creating an order, both ways round.
 *
 * Nearly every real order arrives as a block of text on somebody's phone, so
 * pasting it is the primary path and sits at the top. The form below is the
 * fallback for phone orders and anything the parsers do not recognise.
 *
 * Fields are uncontrolled and plain-named — the action reads them off FormData
 * directly. The only local state is what actually changes the shape of the form:
 * which order type is selected, and how many item rows are showing.
 */
export function OrderComposer({
  outlets,
  today,
  pasteAction,
  createAction,
}: {
  outlets: Outlet[]
  today: string
  pasteAction: (prev: ComposerState, formData: FormData) => Promise<ComposerState>
  createAction: (prev: ComposerState, formData: FormData) => Promise<ComposerState>
}) {
  const [pasteState, paste, pasting] = useActionState(pasteAction, initial)
  const [createState, create, creating] = useActionState(createAction, initial)

  const [orderType, setOrderType] = useState<'RETAIL' | 'BULK'>('RETAIL')
  const [rows, setRows] = useState(1)
  const isBulk = orderType === 'BULK'

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Paste an order" />
        <form action={paste} className="space-y-3 p-4">
          <textarea
            name="body"
            aria-label="Paste the aggregator order message"
            rows={7}
            placeholder={
              'Order From YatriRestro\nOrder Id : #1000584365\n…paste the whole message'
            }
            className={`${inputClass} font-mono text-xs`}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pasting}>
              {pasting ? 'Reading…' : 'Create from paste'}
            </Button>
            <span className="text-xs text-muted">
              The outlet, train, seat and items are read from the message.
            </span>
            <FormNote state={pasteState} />
          </div>
        </form>
      </Card>

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-line" />
        <span className="text-xs font-medium uppercase tracking-wider text-faint">
          or enter it by hand
        </span>
        <div className="h-px flex-1 bg-line" />
      </div>

      <form action={create} className="space-y-5">
        <input type="hidden" name="orderType" value={orderType} />

        <Card>
          <CardHeader title="Order" />
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Field label="Type">
              <div className="flex gap-2">
                {(['RETAIL', 'BULK'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setOrderType(t)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                      orderType === t
                        ? 'border-accent bg-accent-soft text-accent'
                        : 'border-line-strong bg-surface text-muted hover:bg-sunken'
                    }`}
                  >
                    {t === 'RETAIL' ? 'Retail' : 'Bulk'}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Outlet" htmlFor="restaurantId">
              <select id="restaurantId" name="restaurantId" required className={inputClass}>
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </Field>

            <Field label="Service date" htmlFor="serviceDate">
              <input id="serviceDate" name="serviceDate" type="date" defaultValue={today}
                required className={inputClass} />
            </Field>

            <Field label="Arrives at" htmlFor="scheduledArrival" hint="Scheduled time at the station.">
              <input id="scheduledArrival" name="scheduledArrival" type="datetime-local"
                className={inputClass} />
            </Field>

            <Field label="Train number" htmlFor="trainNo" hint="Enables live tracking.">
              <input id="trainNo" name="trainNo" inputMode="numeric" placeholder="12561"
                className={`${inputClass} font-mono`} />
            </Field>

            <Field label="Train name" htmlFor="trainName">
              <input id="trainName" name="trainName" placeholder="SWATANTRA S EXP"
                className={inputClass} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title={isBulk ? 'Handover' : 'Passenger'} />
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            {isBulk ? (
              <>
                <Field label="Pax" htmlFor="pax">
                  <input id="pax" name="pax" type="number" min={1} className={inputClass} />
                </Field>
                <Field label="Ready by" htmlFor="readyBy" hint="When the kitchen must have it done.">
                  <input id="readyBy" name="readyBy" type="datetime-local" className={inputClass} />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Handover point" htmlFor="handoverPoint"
                    hint="Where the rider hands over — e.g. coach B5 door, contact Mr Sharma.">
                    <input id="handoverPoint" name="handoverPoint" className={inputClass} />
                  </Field>
                </div>
              </>
            ) : (
              <>
                <Field label="Coach" htmlFor="coach">
                  <input id="coach" name="coach" placeholder="S6" className={`${inputClass} font-mono uppercase`} />
                </Field>
                <Field label="Berth" htmlFor="berth">
                  <input id="berth" name="berth" placeholder="29" className={`${inputClass} font-mono`} />
                </Field>
              </>
            )}

            <Field label="Contact name" htmlFor="contactName">
              <input id="contactName" name="contactName" className={inputClass} />
            </Field>
            <Field label="Contact phone" htmlFor="contactPhone">
              <input id="contactPhone" name="contactPhone" inputMode="tel"
                className={`${inputClass} font-mono`} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Food" />
          <div className="space-y-4 p-4">
            {isBulk ? (
              <>
                <Field label="Menu" htmlFor="menuSpec"
                  hint="The whole thali as one block. This prints on the ticket verbatim.">
                  <textarea id="menuSpec" name="menuSpec" rows={4} className={inputClass} />
                </Field>
                <Field label="Packing"
                  hint="The part of a large order that gets forgotten.">
                  <div className="flex flex-wrap gap-2">
                    {PACKING_CHOICES.map((p) => (
                      <label key={p}
                        className="flex items-center gap-1.5 rounded-lg border border-line-strong px-2.5 py-1.5 text-sm has-checked:border-accent has-checked:bg-accent-soft has-checked:text-accent">
                        <input type="checkbox" name="packingItems" value={p} className="size-4 rounded border-line-strong" />
                        {p}
                      </label>
                    ))}
                  </div>
                </Field>
              </>
            ) : (
              <>
                {/* Parallel getAll() arrays on the action side — no index encoding
                    in the field names, so a row can be added or dropped freely. */}
                <div className="space-y-2">
                  {Array.from({ length: rows }, (_, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2">
                      <input name="itemName" placeholder="Item name"
                        className={`${inputClass} col-span-7`} />
                      <input name="itemQty" type="number" min={1} defaultValue={1} aria-label="Quantity"
                        className={`${inputClass} col-span-2 text-center`} />
                      <input name="itemPrice" inputMode="decimal" placeholder="₹"
                        className={`${inputClass} col-span-3`} />
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="secondary" onClick={() => setRows((n) => n + 1)}>
                    + Add item
                  </Button>
                  {rows > 1 ? (
                    <Button type="button" size="sm" variant="ghost" onClick={() => setRows((n) => n - 1)}>
                      Remove last
                    </Button>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Payment" />
          <div className="grid gap-4 p-4 sm:grid-cols-3">
            <Field label="Amount" htmlFor="amountRupees">
              <input id="amountRupees" name="amountRupees" inputMode="decimal" placeholder="675"
                className={inputClass} />
            </Field>
            <Field label="Mode" htmlFor="paymentMode">
              <select id="paymentMode" name="paymentMode" className={inputClass}>
                <option value="">—</option>
                <option value="PREPAID">Prepaid</option>
                <option value="COD">Cash on delivery</option>
                <option value="INVOICE">Invoice</option>
              </select>
            </Field>
            <Field label="Notes" htmlFor="notes">
              <input id="notes" name="notes" className={inputClass} />
            </Field>
          </div>
        </Card>

        <div className="flex items-center gap-3">
          <Button type="submit" size="lg" disabled={creating}>
            {creating ? 'Creating…' : 'Create order'}
          </Button>
          <FormNote state={createState} />
        </div>
      </form>
    </div>
  )
}
