'use client'

import { useActionState, useState } from 'react'
import { Button, Card, CardHeader, Field, FormNote, inputClass } from '@/components/ui'
import { parseBulkEnquiry } from '@/lib/ingest/parsers/bulkEnquiry'
import { createEnquiryAction, type EnquiryState } from '../actions'

const initial: EnquiryState = {}

export function EnquiryForm({ today }: { today: string }) {
  const [state, action, pending] = useActionState(createEnquiryAction, initial)

  const [paste, setPaste] = useState('')
  const [serviceDate, setServiceDate] = useState(today)
  const [stationCode, setStationCode] = useState('')
  const [location, setLocation] = useState('')
  const [trainNo, setTrainNo] = useState('')
  const [scheduledArrival, setScheduledArrival] = useState('')
  const [pax, setPax] = useState('')
  const [menuSpec, setMenuSpec] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [notes, setNotes] = useState('')

  /**
   * Plan §7: the parse pre-fills, it never commits. Everything below stays an
   * ordinary editable input, so a bad parse costs the admin a correction rather
   * than a wrong order.
   */
  function applyParse() {
    const r = parseBulkEnquiry(paste)
    if (r.serviceDate) setServiceDate(r.serviceDate)
    if (r.location) setLocation(r.location)
    if (r.trainNo) setTrainNo(r.trainNo)
    if (r.pax) setPax(String(r.pax))
    if (r.menu) setMenuSpec(r.menu)
    if (r.time && r.serviceDate) setScheduledArrival(`${r.serviceDate}T${r.time}`)
    if (r.notes.length) setNotes(r.notes.join('\n'))
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Paste the WhatsApp enquiry" />
        <div className="space-y-3 p-4">
          <textarea
            aria-label="Paste the WhatsApp enquiry message"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={8}
            placeholder={'*Query*\nDate =03-Sep\nLocation =Kanpur Central\nTrain no -\nTime  = 7:30PM\nPax = 75\nMenu = ...'}
            className={`${inputClass} font-mono text-xs`}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={applyParse} disabled={!paste.trim()}>
              Pre-fill the form
            </Button>
            <span className="text-xs text-muted">
              Everything below stays editable. A rough parse is fine.
            </span>
          </div>
        </div>
      </Card>

      <form action={action} className="space-y-5">
        <input type="hidden" name="rawPaste" value={paste} />

        <Card>
          <CardHeader title="Enquiry" />
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Field label="Service date" htmlFor="serviceDate">
              <input id="serviceDate" name="serviceDate" type="date" required value={serviceDate}
                onChange={(e) => setServiceDate(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Station code" htmlFor="stationCode"
              hint="The outlet is chosen when you quote.">
              <input id="stationCode" name="stationCode" required value={stationCode}
                onChange={(e) => setStationCode(e.target.value)} placeholder="CNB"
                className={`${inputClass} font-mono uppercase`} />
            </Field>
            <Field label="Location as written" htmlFor="location">
              <input id="location" name="location" value={location}
                onChange={(e) => setLocation(e.target.value)} placeholder="Kanpur Central"
                className={inputClass} />
            </Field>
            <Field label="Train number" htmlFor="trainNo" hint="Often missing on an enquiry.">
              <input id="trainNo" name="trainNo" value={trainNo}
                onChange={(e) => setTrainNo(e.target.value)} className={`${inputClass} font-mono`} />
            </Field>
            <Field label="Pax" htmlFor="pax">
              <input id="pax" name="pax" type="number" min={1} value={pax}
                onChange={(e) => setPax(e.target.value)} className={`${inputClass} tabular-nums`} />
            </Field>
            <Field label="Requested time" htmlFor="scheduledArrival">
              <input id="scheduledArrival" name="scheduledArrival" type="datetime-local"
                value={scheduledArrival} onChange={(e) => setScheduledArrival(e.target.value)}
                className={inputClass} />
            </Field>
            <Field label="Contact name" htmlFor="contactName">
              <input id="contactName" name="contactName" value={contactName}
                onChange={(e) => setContactName(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Contact phone" htmlFor="contactPhone">
              <input id="contactPhone" name="contactPhone" value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                className={`${inputClass} font-mono tabular-nums`} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Menu" htmlFor="menuSpec"
                hint="One block, line breaks preserved. This prints on the KOT as-is.">
                <textarea id="menuSpec" name="menuSpec" rows={4} value={menuSpec}
                  onChange={(e) => setMenuSpec(e.target.value)} className={inputClass} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Notes" htmlFor="notes"
                hint="Anything the parser did not recognise lands here — nothing is dropped.">
                <textarea id="notes" name="notes" rows={3} value={notes}
                  onChange={(e) => setNotes(e.target.value)} className={inputClass} />
              </Field>
            </div>
          </div>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending} size="lg">
            {pending ? 'Saving…' : 'Save enquiry'}
          </Button>
          <FormNote state={state} />
          <span className="text-sm text-muted">
            Saved at ENQUIRY. It reaches an outlet only after you quote and confirm.
          </span>
        </div>
      </form>
    </div>
  )
}
