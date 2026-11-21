'use client'

import { useActionState, useState, useTransition } from 'react'
import { ClipboardPaste, Plus, Sparkles, Trash2 } from 'lucide-react'
import { Button, Card, Chip, cx, v2Focus } from './ui'
import { Field, FormNote, checkboxV2, inputV2, textareaV2 } from './OrderForms'
import { Select } from './Select'
import { PACKING_CHOICES } from '@/lib/validation/order'
import { DIETS, DIET_LABEL } from '@/lib/diet'
import { ORDER_TYPES, ORDER_TYPE_LABEL } from '@/lib/orderEnums'
import { sourceLabel } from '@/lib/orderEnums'
import {
  createEnquiryV2,
  createOrderV2,
  parsePasteAction,
  pasteOrderV2,
  type ComposerPrefill,
  type ComposerState,
  type ParsePasteResult,
} from '@/app/v2/orders/new/actions'

const initial: ComposerState = {}

/** The dropdown in the square shape of the composer's other fields. */
const formSelectButton = 'rounded-v2-md border-v2-line-strong'

type Kind = 'RETAIL' | 'BULK' | 'LOCAL' | 'ENQUIRY'
type Item = { name: string; qty: string; price: string }
type Fields = Required<Omit<ComposerPrefill, 'orderType' | 'items'>> & { thaliDiet: string }

const EMPTY: Fields = {
  restaurantId: '',
  serviceDate: '',
  scheduledArrival: '',
  trainNo: '',
  trainName: '',
  coach: '',
  berth: '',
  handoverPoint: '',
  pax: '',
  readyBy: '',
  contactName: '',
  contactPhone: '',
  stationCode: '',
  location: '',
  menuSpec: '',
  amountRupees: '',
  paymentMode: '',
  notes: '',
  thaliDiet: '',
}

/**
 * One composer for every way an order starts: an aggregator message pasted
 * whole, a WhatsApp enquiry parsed into the form, or a phone order typed in.
 * Fields are controlled so a parse can fill them; the actions read them by
 * name, same as the v1 forms.
 */
export function OrderComposerV2({ outlets, today, canEnquire }: { outlets: { id: string; label: string }[]; today: string; canEnquire: boolean }) {
  const [kind, setKind] = useState<Kind>('RETAIL')
  const [f, setF] = useState<Fields>({ ...EMPTY, serviceDate: today, restaurantId: outlets[0]?.id ?? '' })
  const [items, setItems] = useState<Item[]>([{ name: '', qty: '1', price: '' }])
  const [paste, setPaste] = useState('')
  const [parsed, setParsed] = useState<ParsePasteResult | null>(null)
  const [parsing, startParsing] = useTransition()
  const [pasteState, pasteAction, pasting] = useActionState(pasteOrderV2, initial)
  const [createState, createAction, creating] = useActionState(createOrderV2, initial)
  const [enquiryState, enquiryAction, savingEnquiry] = useActionState(createEnquiryV2, initial)

  const setField = (k: keyof Fields) => (v: string) => setF((p) => ({ ...p, [k]: v }))
  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setField(k)(e.target.value)

  function applyParse() {
    startParsing(async () => {
      const r = await parsePasteAction(paste)
      setParsed(r)
      if (r.kind === 'none') return
      const p = r.prefill
      setF((prev) => {
        const next = { ...prev }
        for (const [k, v] of Object.entries(p)) {
          if (k === 'orderType' || k === 'items' || v === undefined) continue
          next[k as keyof Fields] = String(v)
        }
        return next
      })
      if (p.items?.length) setItems(p.items)
      if (r.kind === 'enquiry') setKind(canEnquire ? 'ENQUIRY' : 'BULK')
      else setKind('RETAIL')
    })
  }

  const isEnquiry = kind === 'ENQUIRY'
  const isBulk = kind === 'BULK'
  const isLocal = kind === 'LOCAL'
  const kinds: Kind[] = [...ORDER_TYPES, ...(canEnquire ? (['ENQUIRY'] as const) : [])]

  return (
    <div className="grid gap-3.5">
      <Card title="Paste a message" action={<span className="hidden sm:block"><Chip tone="grey">Aggregator or WhatsApp</Chip></span>}>
        <form action={pasteAction} className="grid gap-3">
          <textarea
            name="body"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            aria-label="Paste the aggregator order or WhatsApp enquiry"
            rows={7}
            placeholder={'Order From YatriRestro\nOrder Id : #1000584365\n(paste the whole message)\n\nor a WhatsApp enquiry:\n*Query*\nDate = 03-Sep\nPax = 75\nMenu = ...'}
            className={cx(textareaV2, 'font-mono text-xs')}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="primary" disabled={pasting || !paste.trim()} aria-busy={pasting || undefined}>
              <ClipboardPaste size={16} aria-hidden />
              Create from paste
            </Button>
            <Button type="button" onClick={applyParse} disabled={parsing || !paste.trim()} aria-busy={parsing || undefined}>
              <Sparkles size={16} aria-hidden />
              {parsing ? 'Reading' : 'Parse into the form'}
            </Button>
            <FormNote state={pasteState} />
          </div>
          <p className="text-xs text-v2-muted">
            Create from paste keeps the aggregator&apos;s id and source, as email ingestion would. Parse only fills the form below so you can correct it first.
          </p>
          {parsed?.kind === 'order' ? (
            <p className="text-xs font-medium text-v2-ok">
              Read a {sourceLabel(parsed.source)} order <span className="font-mono">{parsed.externalOrderId}</span> for {parsed.outletName}
              {parsed.outletMatched ? '. Outlet matched.' : '. That outlet is not one of yours: pick one below.'}
            </p>
          ) : null}
          {parsed?.kind === 'enquiry' ? <p className="text-xs font-medium text-v2-ok">Read a bulk enquiry. Everything below stays editable.</p> : null}
          {parsed?.kind === 'none' ? (
            <p role="alert" className="text-xs font-semibold text-v2-bad">
              {parsed.detail}
            </p>
          ) : null}
        </form>
      </Card>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-v2-line" />
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-v2-faint">or enter it by hand</span>
        <span className="h-px flex-1 bg-v2-line" />
      </div>

      <form action={isEnquiry ? enquiryAction : createAction} className="grid gap-3.5">
        {isEnquiry ? <input type="hidden" name="rawPaste" value={paste} /> : <input type="hidden" name="orderType" value={kind} />}

        <div className="grid gap-3.5 xl:grid-cols-2">
          <Card title="Order">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Type" className="sm:col-span-2">
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Order type">
                  {kinds.map((t) => (
                    <button
                      key={t}
                      type="button"
                      role="radio"
                      aria-checked={kind === t}
                      onClick={() => setKind(t)}
                      className={cx(
                        'rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors',
                        kind === t ? 'border-v2-brand bg-v2-brand text-white' : 'border-v2-line bg-v2-surface text-v2-ink-2 hover:bg-v2-surface-2',
                        v2Focus,
                      )}
                    >
                      {t === 'ENQUIRY' ? 'Bulk enquiry' : ORDER_TYPE_LABEL[t]}
                    </button>
                  ))}
                </div>
                {isEnquiry ? <p className="text-xs text-v2-muted">Saved at Enquiry. The outlet is chosen when you quote; it reaches a kitchen only after you confirm.</p> : null}
              </Field>

              {isEnquiry ? (
                <>
                  <Field label="Station code" htmlFor="stationCode">
                    <input id="stationCode" name="stationCode" required value={f.stationCode} onChange={set('stationCode')} placeholder="CNB" className={cx(inputV2, 'font-mono uppercase')} />
                  </Field>
                  <Field label="Location as written" htmlFor="location">
                    <input id="location" name="location" value={f.location} onChange={set('location')} placeholder="Kanpur Central" className={inputV2} />
                  </Field>
                </>
              ) : (
                <Field label="Outlet" htmlFor="restaurantId" className="sm:col-span-2">
                  <Select
                    id="restaurantId"
                    name="restaurantId"
                    value={f.restaurantId}
                    onChange={setField('restaurantId')}
                    placeholder="Choose an outlet"
                    buttonClassName={formSelectButton}
                    options={outlets.map((o) => ({ value: o.id, label: o.label }))}
                  />
                </Field>
              )}

              <Field label="Service date" htmlFor="serviceDate">
                <input id="serviceDate" name="serviceDate" type="date" required value={f.serviceDate} onChange={set('serviceDate')} className={inputV2} />
              </Field>

              {isLocal ? null : (
                <>
                  <Field label={isEnquiry ? 'Requested time' : 'Arrives at'} htmlFor="scheduledArrival" hint={isEnquiry ? undefined : 'Scheduled time at the station.'}>
                    <input id="scheduledArrival" name="scheduledArrival" type="datetime-local" value={f.scheduledArrival} onChange={set('scheduledArrival')} className={inputV2} />
                  </Field>
                  <Field label="Train number" htmlFor="trainNo" hint={isEnquiry ? 'Often missing on an enquiry.' : 'Enables live tracking.'}>
                    <input id="trainNo" name="trainNo" inputMode="numeric" value={f.trainNo} onChange={set('trainNo')} placeholder="12561" className={cx(inputV2, 'font-mono')} />
                  </Field>
                  {isEnquiry ? null : (
                    <Field label="Train name" htmlFor="trainName">
                      <input id="trainName" name="trainName" value={f.trainName} onChange={set('trainName')} placeholder="SWATANTRA S EXP" className={inputV2} />
                    </Field>
                  )}
                </>
              )}
            </div>
          </Card>

          <Card title={isBulk || isEnquiry ? 'Handover' : isLocal ? 'Delivery' : 'Passenger'}>
            <div className="grid gap-3 sm:grid-cols-2">
              {isLocal ? (
                <>
                  <Field label="Deliver to" htmlFor="handoverPoint" hint="Where it goes. For example: tea stall, platform 3, or counter pickup." className="sm:col-span-2">
                    <input id="handoverPoint" name="handoverPoint" required value={f.handoverPoint} onChange={set('handoverPoint')} className={inputV2} />
                  </Field>
                  <Field label="Ready by" htmlFor="readyBy" hint="When the kitchen must have it done.">
                    <input id="readyBy" name="readyBy" type="datetime-local" value={f.readyBy} onChange={set('readyBy')} className={inputV2} />
                  </Field>
                </>
              ) : isBulk || isEnquiry ? (
                <>
                  <Field label="Pax" htmlFor="pax">
                    <input id="pax" name="pax" type="number" min={1} value={f.pax} onChange={set('pax')} className={cx(inputV2, 'font-mono')} />
                  </Field>
                  {isEnquiry ? null : (
                    <>
                      <Field label="Ready by" htmlFor="readyBy" hint="When the kitchen must have it done.">
                        <input id="readyBy" name="readyBy" type="datetime-local" value={f.readyBy} onChange={set('readyBy')} className={inputV2} />
                      </Field>
                      <Field label="Handover point" htmlFor="handoverPoint" hint="Where the rider hands over. For example: coach B5 door, contact Mr Sharma." className="sm:col-span-2">
                        <input id="handoverPoint" name="handoverPoint" value={f.handoverPoint} onChange={set('handoverPoint')} className={inputV2} />
                      </Field>
                    </>
                  )}
                </>
              ) : (
                <>
                  <Field label="Coach" htmlFor="coach">
                    <input id="coach" name="coach" value={f.coach} onChange={set('coach')} placeholder="S6" className={cx(inputV2, 'font-mono uppercase')} />
                  </Field>
                  <Field label="Berth" htmlFor="berth">
                    <input id="berth" name="berth" value={f.berth} onChange={set('berth')} placeholder="29" className={cx(inputV2, 'font-mono')} />
                  </Field>
                </>
              )}
              <Field label="Contact name" htmlFor="contactName">
                <input id="contactName" name="contactName" value={f.contactName} onChange={set('contactName')} className={inputV2} />
              </Field>
              <Field label="Contact phone" htmlFor="contactPhone">
                <input id="contactPhone" name="contactPhone" inputMode="tel" autoComplete="off" value={f.contactPhone} onChange={set('contactPhone')} className={cx(inputV2, 'font-mono')} />
              </Field>
            </div>
          </Card>
        </div>

        <div className="grid gap-3.5 xl:grid-cols-[1.4fr_1fr]">
          <Card title="Food">
            {isBulk || isEnquiry ? (
              <div className="grid gap-3">
                <Field label="Menu" htmlFor="menuSpec" hint="The whole thali as one block. This prints on the ticket verbatim.">
                  <textarea id="menuSpec" name="menuSpec" rows={5} value={f.menuSpec} onChange={set('menuSpec')} className={textareaV2} />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Thali is" htmlFor="thaliDiet" hint="Decides which KOT it prints on. Left unset, it prints with a ? until set on the order.">
                    <Select
                      id="thaliDiet"
                      name="thaliDiet"
                      value={f.thaliDiet}
                      onChange={setField('thaliDiet')}
                      buttonClassName={formSelectButton}
                      options={[{ value: '', label: 'Not said yet' }, ...DIETS.map((d) => ({ value: d, label: DIET_LABEL[d] }))]}
                    />
                  </Field>
                  {isEnquiry ? null : (
                    <Field label="Packing" hint="The part of a large order that gets forgotten.">
                      <div className="flex flex-wrap gap-1.5">
                        {PACKING_CHOICES.map((p) => (
                          <label key={p} className="flex cursor-pointer items-center gap-1.5 rounded-full border border-v2-line px-2.5 py-1 text-[13px] has-checked:border-v2-brand has-checked:bg-v2-brand-soft has-checked:text-v2-brand">
                            <input type="checkbox" name="packingItems" value={p} className={checkboxV2} />
                            {p}
                          </label>
                        ))}
                      </div>
                    </Field>
                  )}
                </div>
              </div>
            ) : (
              <div className="grid gap-2">
                {/* Parallel getAll() arrays on the action side, so rows come and go freely. */}
                <div className="hidden grid-cols-[minmax(0,1fr)_4.5rem_6rem_2rem] gap-2 text-[11px] font-bold uppercase tracking-[0.1em] text-v2-faint sm:grid">
                  <span>Item</span>
                  <span>Qty</span>
                  <span>Price ₹</span>
                  <span />
                </div>
                {/* On a phone the name takes a row of its own; qty, price and remove sit under it. */}
                {items.map((it, i) => (
                  <div key={i} className="grid grid-cols-[4.5rem_minmax(0,1fr)_2rem] items-center gap-2 border-b border-v2-line pb-2 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_4.5rem_6rem_2rem] sm:border-b-0 sm:pb-0">
                    <input name="itemName" value={it.name} onChange={(e) => setItems((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Item name" aria-label="Item name" className={cx(inputV2, 'col-span-3 sm:col-span-1')} />
                    <input name="itemQty" type="number" min={1} value={it.qty} onChange={(e) => setItems((p) => p.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} placeholder="Qty" aria-label="Quantity" className={cx(inputV2, 'text-center font-mono')} />
                    <input name="itemPrice" inputMode="decimal" value={it.price} onChange={(e) => setItems((p) => p.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} placeholder="Price ₹" aria-label="Price in rupees" className={cx(inputV2, 'font-mono')} />
                    <button
                      type="button"
                      onClick={() => setItems((p) => (p.length > 1 ? p.filter((_, j) => j !== i) : [{ name: '', qty: '1', price: '' }]))}
                      aria-label={`Remove row ${i + 1}`}
                      className={cx('grid h-8 w-8 place-items-center rounded-full text-v2-faint hover:bg-v2-surface-2 hover:text-v2-bad', v2Focus)}
                    >
                      <Trash2 size={14} aria-hidden />
                    </button>
                  </div>
                ))}
                <div>
                  <Button type="button" size="sm" onClick={() => setItems((p) => [...p, { name: '', qty: '1', price: '' }])}>
                    <Plus size={14} aria-hidden />
                    Add item
                  </Button>
                </div>
              </div>
            )}
          </Card>

          <Card title={isEnquiry ? 'Notes' : 'Payment'}>
            {isEnquiry ? (
              <Field label="Notes" htmlFor="notes" hint="Anything the parser did not recognise lands here. Nothing is dropped.">
                <textarea id="notes" name="notes" rows={6} value={f.notes} onChange={set('notes')} className={textareaV2} />
              </Field>
            ) : (
              <div className="grid gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Amount (₹)" htmlFor="amountRupees">
                    <input id="amountRupees" name="amountRupees" inputMode="decimal" value={f.amountRupees} onChange={set('amountRupees')} placeholder="675" className={cx(inputV2, 'font-mono')} />
                  </Field>
                  <Field label="Mode" htmlFor="paymentMode">
                    <Select
                      id="paymentMode"
                      name="paymentMode"
                      value={f.paymentMode}
                      onChange={setField('paymentMode')}
                      buttonClassName={formSelectButton}
                      options={[
                        { value: '', label: 'Not set' },
                        { value: 'PREPAID', label: 'Prepaid' },
                        { value: 'COD', label: 'Cash on delivery' },
                        { value: 'INVOICE', label: 'Invoice' },
                      ]}
                    />
                  </Field>
                </div>
                <Field label="Notes" htmlFor="notes">
                  <textarea id="notes" name="notes" rows={3} value={f.notes} onChange={set('notes')} className={textareaV2} />
                </Field>
              </div>
            )}
          </Card>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="lg" variant="primary" disabled={creating || savingEnquiry} aria-busy={creating || savingEnquiry || undefined}>
            {isEnquiry ? 'Save enquiry' : 'Create order'}
          </Button>
          <FormNote state={isEnquiry ? enquiryState : createState} />
        </div>
      </form>
    </div>
  )
}
