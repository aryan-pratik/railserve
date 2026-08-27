'use client'

import { useActionState, useMemo, useState } from 'react'
import { Card, CardHeader, Field, inputClass } from '@/components/ui'
import { PACKING_CHOICES } from '@/lib/validation/order'
import { createOrderAction, type CreateOrderState } from './actions'

type Outlet = { id: string; name: string; stationCode: string; stationName: string | null }
type ItemRow = { name: string; qty: string; priceRupees: string; isPacking: boolean; notes: string }

const emptyItem: ItemRow = { name: '', qty: '1', priceRupees: '', isPacking: false, notes: '' }
const initialState: CreateOrderState = {}

export function OrderForm({ outlets, today }: { outlets: Outlet[]; today: string }) {
  const [state, formAction, pending] = useActionState(createOrderAction, initialState)

  const [orderType, setOrderType] = useState<'RETAIL' | 'BULK'>('RETAIL')
  const [restaurantId, setRestaurantId] = useState(outlets[0]?.id ?? '')
  const [serviceDate, setServiceDate] = useState(today)
  const [trainNo, setTrainNo] = useState('')
  const [trainName, setTrainName] = useState('')
  const [scheduledArrival, setScheduledArrival] = useState('')
  const [coach, setCoach] = useState('')
  const [berth, setBerth] = useState('')
  const [handoverPoint, setHandoverPoint] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [pax, setPax] = useState('')
  const [amountRupees, setAmountRupees] = useState('')
  const [paymentMode, setPaymentMode] = useState('COD')
  const [readyBy, setReadyBy] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<ItemRow[]>([{ ...emptyItem }])
  const [menuSpec, setMenuSpec] = useState('')
  const [packingItems, setPackingItems] = useState<string[]>([])

  const isBulk = orderType === 'BULK'
  const err = state.fieldErrors ?? {}

  const payload = useMemo(
    () =>
      JSON.stringify({
        orderType,
        restaurantId,
        serviceDate,
        trainNo: trainNo || null,
        trainName: trainName || null,
        scheduledArrival: scheduledArrival || null,
        coach: coach || null,
        berth: berth || null,
        handoverPoint: handoverPoint || null,
        contactName: contactName || null,
        contactPhone: contactPhone || null,
        pax: pax ? Number(pax) : null,
        amountRupees: amountRupees || null,
        paymentMode: paymentMode || null,
        readyBy: readyBy || null,
        notes: notes || null,
        items: isBulk
          ? []
          : items
              .filter((i) => i.name.trim())
              .map((i) => ({
                name: i.name,
                qty: Number(i.qty) || 1,
                priceRupees: i.priceRupees || null,
                isPacking: i.isPacking,
                notes: i.notes || null,
              })),
        menuSpec: isBulk ? menuSpec || null : null,
        packingItems: isBulk ? packingItems : [],
      }),
    [orderType, restaurantId, serviceDate, trainNo, trainName, scheduledArrival, coach, berth,
      handoverPoint, contactName, contactPhone, pax, amountRupees, paymentMode, readyBy, notes,
      items, menuSpec, packingItems, isBulk],
  )

  function updateItem(idx: number, patch: Partial<ItemRow>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="payload" value={payload} />

      {state.error ? (
        <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      ) : null}

      {/* Order type ------------------------------------------------------ */}
      <Card>
        <CardHeader title="Order type" />
        <div className="flex gap-2 p-4">
          {(['RETAIL', 'BULK'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setOrderType(t)}
              className={`flex-1 rounded-lg border px-4 py-3 text-left transition ${
                orderType === t
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-300 bg-white hover:bg-slate-50'
              }`}
            >
              <div className="font-semibold">{t}</div>
              <div className={`text-xs ${orderType === t ? 'text-slate-300' : 'text-slate-500'}`}>
                {t === 'RETAIL' ? 'Seat delivery, itemised' : 'Group handover, one composite menu'}
              </div>
            </button>
          ))}
        </div>
      </Card>

      {/* Journey --------------------------------------------------------- */}
      <Card>
        <CardHeader title="Outlet and journey" />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="Outlet" htmlFor="restaurantId" error={err.restaurantId}>
            <select
              id="restaurantId" value={restaurantId}
              onChange={(e) => setRestaurantId(e.target.value)} className={inputClass}
            >
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} — {o.stationCode}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Service date" htmlFor="serviceDate" error={err.serviceDate}
            hint="The day the train is at the station, in IST.">
            <input id="serviceDate" type="date" value={serviceDate}
              onChange={(e) => setServiceDate(e.target.value)} className={inputClass} />
          </Field>

          <Field label="Train number" htmlFor="trainNo" hint="Optional. Bulk enquiries often lack it.">
            <input id="trainNo" value={trainNo} onChange={(e) => setTrainNo(e.target.value)}
              placeholder="12506" className={inputClass} />
          </Field>

          <Field label="Train name" htmlFor="trainName">
            <input id="trainName" value={trainName} onChange={(e) => setTrainName(e.target.value)}
              placeholder="NORTH EAST EXP" className={inputClass} />
          </Field>

          <Field label="Scheduled arrival" htmlFor="scheduledArrival"
            hint="IST. No live tracking yet — this is the time the run is planned around.">
            <input id="scheduledArrival" type="datetime-local" value={scheduledArrival}
              onChange={(e) => setScheduledArrival(e.target.value)} className={inputClass} />
          </Field>
        </div>
      </Card>

      {/* Delivery point -------------------------------------------------- */}
      <Card>
        <CardHeader title={isBulk ? 'Handover' : 'Seat'} />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          {isBulk ? (
            <>
              <Field label="Pax" htmlFor="pax" error={err.pax}>
                <input id="pax" type="number" min={1} value={pax}
                  onChange={(e) => setPax(e.target.value)} placeholder="75" className={inputClass} />
              </Field>
              <Field label="Ready by" htmlFor="readyBy" error={err.readyBy}
                hint="Mandatory for bulk — the kitchen plans backwards from this.">
                <input id="readyBy" type="datetime-local" value={readyBy}
                  onChange={(e) => setReadyBy(e.target.value)} className={inputClass} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Handover point" htmlFor="handoverPoint" error={err.handoverPoint}
                  hint="Where and to whom, e.g. “coach B5 door, contact Mr Sharma”.">
                  <input id="handoverPoint" value={handoverPoint}
                    onChange={(e) => setHandoverPoint(e.target.value)} className={inputClass} />
                </Field>
              </div>
            </>
          ) : (
            <>
              <Field label="Coach" htmlFor="coach">
                <input id="coach" value={coach} onChange={(e) => setCoach(e.target.value)}
                  placeholder="B5" className={inputClass} />
              </Field>
              <Field label="Berth" htmlFor="berth">
                <input id="berth" value={berth} onChange={(e) => setBerth(e.target.value)}
                  placeholder="37" className={inputClass} />
              </Field>
            </>
          )}

          <Field label="Contact name" htmlFor="contactName">
            <input id="contactName" value={contactName}
              onChange={(e) => setContactName(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Contact phone" htmlFor="contactPhone" error={err.contactPhone}>
            <input id="contactPhone" type="tel" inputMode="numeric" value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)} className={inputClass} />
          </Field>
        </div>
      </Card>

      {/* Food ------------------------------------------------------------ */}
      <Card>
        <CardHeader title="Food" />
        <div className="space-y-4 p-4">
          {isBulk ? (
            <>
              <Field label="Menu" htmlFor="menuSpec" error={err.menuSpec}
                hint="One block of text, line breaks preserved. This prints on the KOT as-is.">
                <textarea id="menuSpec" rows={5} value={menuSpec}
                  onChange={(e) => setMenuSpec(e.target.value)}
                  placeholder="2pcs Egg Curry + Dry aloo jeera + Dal Fry + Jeera Rice + 3 Butter Roti + Sweet (Gulab Jamun) + Salad + Pickle"
                  className={inputClass} />
              </Field>

              <div>
                <span className="mb-1 block text-sm font-medium text-slate-700">Packing</span>
                <p className="mb-2 text-xs text-slate-500">
                  The part of a large order that gets forgotten. Ticked items print in their own
                  KOT section.
                </p>
                <div className="flex flex-wrap gap-2">
                  {PACKING_CHOICES.map((choice) => {
                    const on = packingItems.includes(choice)
                    return (
                      <button
                        key={choice} type="button"
                        onClick={() =>
                          setPackingItems((prev) =>
                            on ? prev.filter((c) => c !== choice) : [...prev, choice],
                          )
                        }
                        className={`rounded-full border px-3 py-1.5 text-sm transition ${
                          on
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {on ? '✓ ' : ''}{choice}
                      </button>
                    )
                  })}
                </div>
              </div>
            </>
          ) : (
            <>
              {err.items ? <p className="text-xs font-medium text-red-600">{err.items}</p> : null}
              <div className="space-y-2">
                {items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 items-center gap-2">
                    <input
                      aria-label={`Item ${idx + 1} name`} value={item.name}
                      onChange={(e) => updateItem(idx, { name: e.target.value })}
                      placeholder="Paneer Paratha With Curd Combo"
                      className={`${inputClass} col-span-12 sm:col-span-5`} />
                    <input
                      aria-label={`Item ${idx + 1} quantity`} type="number" min={1} value={item.qty}
                      onChange={(e) => updateItem(idx, { qty: e.target.value })}
                      className={`${inputClass} col-span-3 sm:col-span-2`} />
                    <input
                      aria-label={`Item ${idx + 1} price`} value={item.priceRupees}
                      onChange={(e) => updateItem(idx, { priceRupees: e.target.value })}
                      placeholder="₹" className={`${inputClass} col-span-4 sm:col-span-2`} />
                    <label className="col-span-4 flex items-center gap-1.5 text-xs text-slate-600 sm:col-span-2">
                      <input type="checkbox" checked={item.isPacking}
                        onChange={(e) => updateItem(idx, { isPacking: e.target.checked })}
                        className="rounded border-slate-300" />
                      Packing
                    </label>
                    <button
                      type="button" aria-label={`Remove item ${idx + 1}`}
                      onClick={() => setItems((p) => (p.length === 1 ? p : p.filter((_, i) => i !== idx)))}
                      disabled={items.length === 1}
                      className="col-span-1 rounded-lg px-2 py-2 text-slate-400 hover:bg-slate-100 hover:text-red-600 disabled:opacity-30"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button" onClick={() => setItems((p) => [...p, { ...emptyItem }])}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                + Add item
              </button>
            </>
          )}
        </div>
      </Card>

      {/* Payment --------------------------------------------------------- */}
      <Card>
        <CardHeader title="Payment and notes" />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="Amount (₹)" htmlFor="amountRupees"
            hint="Stored as integer paise. Enter rupees.">
            <input id="amountRupees" inputMode="decimal" value={amountRupees}
              onChange={(e) => setAmountRupees(e.target.value)} placeholder="236.00"
              className={inputClass} />
          </Field>
          <Field label="Payment mode" htmlFor="paymentMode">
            <select id="paymentMode" value={paymentMode}
              onChange={(e) => setPaymentMode(e.target.value)} className={inputClass}>
              <option value="COD">Cash on delivery</option>
              <option value="PREPAID">Prepaid</option>
              <option value="INVOICE">Invoice</option>
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Notes" htmlFor="notes">
              <textarea id="notes" rows={2} value={notes}
                onChange={(e) => setNotes(e.target.value)} className={inputClass} />
            </Field>
          </div>
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <button
          type="submit" disabled={pending || outlets.length === 0}
          className="rounded-lg bg-slate-900 px-5 py-2.5 font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
        >
          {pending ? 'Creating…' : 'Create order'}
        </button>
        <span className="text-sm text-slate-500">
          Enters at RECEIVED and appears on the outlet&apos;s dashboard immediately.
        </span>
      </div>
    </form>
  )
}
