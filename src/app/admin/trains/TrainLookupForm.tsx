'use client'

import { useActionState } from 'react'
import { Button, Card, CardHeader, Field, inputClass } from '@/components/ui'
import { lookupTrain, type LookupState } from './actions'

const initial: LookupState = {}

function Row({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2.5 last:border-0">
      <span className="text-sm text-muted">{label}</span>
      <span className={`text-right text-sm font-medium text-ink ${tone}`}>{value}</span>
    </div>
  )
}

const istTime = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
  })

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins === 0) return 'moments ago'
  if (mins < 60) return `${mins} min ago`
  const h = Math.floor(mins / 60)
  return `${h}h ${mins % 60}m ago`
}

/** "KANPUR CENTRAL (CNB)" — a bare code means nothing to someone new. */
function place(name: string | null, code: string | null): string {
  if (name && code) return `${name} (${code})`
  return name ?? code ?? '—'
}

export function TrainLookupForm({
  stations, today,
}: {
  stations: string[]
  today: string
}) {
  const [state, action, pending] = useActionState(lookupTrain, initial)
  const r = state.result

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Look up a train" />
        <form action={action} className="grid gap-4 p-4 sm:grid-cols-4">
          <Field label="Train number" htmlFor="trainNo">
            <input id="trainNo" name="trainNo" required inputMode="numeric"
              placeholder="12561" className={inputClass} />
          </Field>

          <Field label="Station code" htmlFor="stationCode"
            hint={stations.length ? `Your outlets: ${stations.join(', ')}` : undefined}>
            <input id="stationCode" name="stationCode" required list="station-codes"
              defaultValue={stations[0] ?? ''} placeholder="CNB"
              className={`${inputClass} uppercase`} />
            <datalist id="station-codes">
              {stations.map((s) => <option key={s} value={s} />)}
            </datalist>
          </Field>

          <Field label="Date" htmlFor="serviceDate" hint="The day it reaches this station.">
            <input id="serviceDate" name="serviceDate" type="date" defaultValue={today}
              className={inputClass} />
          </Field>

          <div className="flex items-end">
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? 'Checking…' : 'Check status'}
            </Button>
          </div>

          {state.error ? (
            <p className="text-sm font-medium text-red-600 sm:col-span-4">{state.error}</p>
          ) : null}
        </form>
      </Card>

      {r ? (
        <Card>
          <CardHeader
            title={
              <span>
                {r.trainName ? `${r.trainName} · ` : ''}
                <span className="font-mono">{r.trainNo}</span>
              </span>
            }
          />

          <div className="px-4 py-2">
            {r.simulated ? (
              <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                These times are <strong>simulated</strong>, not live — no real train API is
                configured for this environment.
              </p>
            ) : null}

            {r.statusNote ? (
              <p className="mb-3 rounded-lg bg-sunken px-3 py-2 text-sm text-ink">{r.statusNote}</p>
            ) : null}

            {/* What we are actually asking about — a delay is meaningless
                without saying delayed to WHERE. */}
            <Row label="Delivering at" value={place(r.stationName, r.stationCode)} />
            <Row label="Service date" value={r.serviceDate} />

            <Row
              label="Scheduled arrival"
              value={r.scheduledArrivalIso ? `${istTime(r.scheduledArrivalIso)} IST` : 'not published'}
            />
            <Row
              label="Expected arrival"
              value={r.etaAtIso ? `${istTime(r.etaAtIso)} IST` : 'not reported'}
              tone={r.delayMinutes && r.delayMinutes > 0 ? 'text-red-600' : ''}
            />
            {/* Directly under the ETA, because it is what the ETA is worth: a
                projection made from a position an hour old is an hour-old
                projection. The empty case is stated rather than hidden — a run
                that has not left its source has no update, and RailKit sends
                an empty string for it, which as a blank line reads as a bug in
                us rather than as news about the train. */}
            <Row
              label="Feed last updated"
              value={
                r.providerUpdatedAtIso
                  ? `${istTime(r.providerUpdatedAtIso)} IST · ${ago(r.providerUpdatedAtIso)}`
                  : 'never — this run has not reported yet'
              }
            />
            <Row
              label="Delay"
              value={
                r.delayMinutes === null
                  ? 'unknown'
                  : r.delayMinutes <= 0
                    ? 'on time'
                    : r.delayMinutes >= 60
                      ? `${Math.floor(r.delayMinutes / 60)}h ${r.delayMinutes % 60}m late`
                      : `${r.delayMinutes} min late`
              }
              tone={r.delayMinutes && r.delayMinutes > 0 ? 'text-red-600' : ''}
            />
            <Row label="Platform" value={r.platform ? `PF ${r.platform}` : 'not announced'} />

            <Row
              label="Train is now at"
              value={
                r.currentStationCode
                  ? place(r.currentStationName, r.currentStationCode)
                  : 'not started yet'
              }
            />
            <Row
              label="Still to go"
              value={[
                r.stopsAway !== null
                  ? r.stopsAway === 0
                    ? 'at this station'
                    : `${r.stopsAway} stop${r.stopsAway === 1 ? '' : 's'}`
                  : null,
                r.distanceKm !== null ? `${r.distanceKm} km into the run` : null,
              ]
                .filter(Boolean)
                .join(' · ') || '—'}
            />
          </div>

          <p className="border-t border-line px-4 py-2.5 text-xs text-muted">
            This reading is now cached for {r.trainNo} at {r.stationCode}, so the store and rider
            boards show the same times without spending another API request.
          </p>
        </Card>
      ) : null}
    </div>
  )
}
