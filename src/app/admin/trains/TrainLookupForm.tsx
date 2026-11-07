'use client'

import { useActionState, useState, type ReactNode } from 'react'
import { IconCalendar, IconLocate, IconSearch, IconTrain } from '@/components/Icons'
import { Button, Card, Notice, focusRing, inputClass } from '@/components/ui'
import { lookupTrain, type LookupState, type TrainLookup } from './actions'

const initial: LookupState = {}

/* ── formatting ───────────────────────────────────────────────────────────── */

const IST = 'Asia/Kolkata'

/** "02:35 pm": the figure someone actually reads off the screen. */
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { timeZone: IST, hour: '2-digit', minute: '2-digit', hour12: true })

/** "07 Nov": under the clock, so a run past midnight is not misread. */
const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { timeZone: IST, day: '2-digit', month: 'short' })

/** "Sat, 07 Nov 2026" for the yyyy-mm-dd service date. */
function serviceDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) return ymd
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  })
}

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins === 0) return 'moments ago'
  if (mins < 60) return `${mins} min ago`
  const h = Math.floor(mins / 60)
  return `${h}h ${mins % 60}m ago`
}

function delayText(minutes: number): string {
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes} min`
}

/* ── status ───────────────────────────────────────────────────────────────── */

type Health = { label: string; pill: string; dot: string; figure: string }

/**
 * One reading of the run, used by the pill in the header and the colour of
 * the delay and expected-arrival figures, so the three never disagree.
 */
function health(r: TrainLookup): Health {
  if (r.arrived) {
    return { label: 'Left the station', pill: 'bg-sunken text-muted ring-line-strong', dot: 'bg-faint', figure: 'text-ink' }
  }
  if (r.delayMinutes === null) {
    return { label: 'Status unknown', pill: 'bg-sunken text-muted ring-line-strong', dot: 'bg-faint', figure: 'text-ink' }
  }
  if (r.delayMinutes <= 0) {
    return { label: 'On time', pill: 'bg-emerald-50 text-emerald-800 ring-emerald-200', dot: 'bg-emerald-500', figure: 'text-emerald-700' }
  }
  if (r.delayMinutes < 30) {
    return { label: `${delayText(r.delayMinutes)} late`, pill: 'bg-amber-50 text-amber-900 ring-amber-200', dot: 'bg-amber-500', figure: 'text-amber-700' }
  }
  return { label: `${delayText(r.delayMinutes)} late`, pill: 'bg-red-50 text-red-800 ring-red-200', dot: 'bg-red-500', figure: 'text-red-600' }
}

/* ── pieces ───────────────────────────────────────────────────────────────── */

/** One figure on the result's instrument strip. */
function Figure({
  label, value, sub, tone = 'text-ink',
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: string
}) {
  return (
    <div className="px-5 py-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1.5 text-2xl font-semibold tabular-nums tracking-tight ${tone}`}>{value}</div>
      {/* Reserved height so the strip lines up with and without a sub-line. */}
      <div className="mt-1 h-4 truncate text-xs text-faint">{sub}</div>
    </div>
  )
}

/**
 * Where the train is against where it is going: two stops and a track
 * between them. The gap is labelled with what is left, which is the question
 * someone opening this page is asking.
 */
function Journey({ r }: { r: TrainLookup }) {
  const started = Boolean(r.currentStationCode)
  const atStation = r.stopsAway === 0 || r.arrived
  const remaining = [
    r.stopsAway !== null && r.stopsAway > 0 ? `${r.stopsAway} stop${r.stopsAway === 1 ? '' : 's'} to go` : null,
    r.distanceKm !== null ? `${r.distanceKm} km into the run` : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className="grid grid-cols-2 items-center gap-x-4 gap-y-4 px-5 py-5 sm:grid-cols-[auto_1fr_auto]">
      {/* Now */}
      <div className="flex items-center gap-2.5">
        <span className={`relative flex size-3 shrink-0`}>
          {started && !atStation ? (
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-50 motion-reduce:animate-none" />
          ) : null}
          <span className={`relative inline-flex size-3 rounded-full ${started ? 'bg-accent' : 'bg-line-strong'}`} />
        </span>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Train is now at</div>
          <div className="truncate text-sm font-semibold text-ink">
            {started ? (r.currentStationName ?? r.currentStationCode) : 'Not started yet'}
          </div>
          {started && r.currentStationName ? (
            <div className="font-mono text-xs text-faint">{r.currentStationCode}</div>
          ) : null}
        </div>
      </div>

      {/* Track */}
      <div className="order-last col-span-2 flex min-w-0 flex-col items-center gap-1.5 sm:order-none sm:col-span-1">
        <div className="relative h-1 w-full rounded-full bg-sunken">
          <div
            className={`absolute inset-y-0 left-0 rounded-full ${atStation ? 'w-full bg-accent' : started ? 'w-1/2 bg-accent/70' : 'w-0'}`}
          />
          {started && !atStation ? (
            <span className="absolute left-1/2 top-1/2 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-surface text-accent shadow-sm">
              <IconTrain size={13} aria-hidden />
            </span>
          ) : null}
        </div>
        <div className="truncate text-center text-xs text-muted">
          {atStation ? 'At your station' : remaining || ' '}
        </div>
      </div>

      {/* Destination */}
      <div className="flex items-center justify-end gap-2.5 text-right">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Delivering at</div>
          <div className="truncate text-sm font-semibold text-ink">{r.stationName ?? r.stationCode}</div>
          {r.stationName ? <div className="font-mono text-xs text-faint">{r.stationCode}</div> : null}
        </div>
        <span className={`inline-flex size-3 shrink-0 rounded-full ring-4 ${atStation ? 'bg-accent ring-accent-soft' : 'bg-surface ring-line-strong'}`} />
      </div>
    </div>
  )
}

export function TrainResult({ r }: { r: TrainLookup }) {
  const h = health(r)
  const late = r.delayMinutes !== null && r.delayMinutes > 0

  return (
    <Card className="overflow-hidden">
      {/* Header: which train, which day, and the one-word answer. */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-line px-5 py-4">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <IconTrain size={22} aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <h2 className="truncate text-lg font-semibold tracking-tight text-ink">
                {r.trainName ?? 'Train'}
              </h2>
              <span className="font-mono text-sm font-semibold text-muted">{r.trainNo}</span>
            </div>
            <p className="text-sm text-muted">{serviceDay(r.serviceDate)}</p>
          </div>
        </div>
        <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ring-1 ring-inset ${h.pill}`}>
          <span aria-hidden className={`size-2 rounded-full ${h.dot}`} />
          {h.label}
        </span>
      </div>

      {r.simulated || r.statusNote ? (
        <div className="space-y-2 border-b border-line px-5 py-3">
          {r.simulated ? (
            <Notice tone="warn">These times are simulated, not live. No real train API is configured for this environment.</Notice>
          ) : null}
          {r.statusNote ? <Notice>{r.statusNote}</Notice> : null}
        </div>
      ) : null}

      <Journey r={r} />

      <div className="grid grid-cols-2 gap-px border-t border-line bg-line lg:grid-cols-4 [&>*]:bg-surface">
        <Figure
          label="Scheduled arrival"
          value={r.scheduledArrivalIso ? clock(r.scheduledArrivalIso) : '—'}
          sub={r.scheduledArrivalIso ? `${day(r.scheduledArrivalIso)} · IST` : 'Not published'}
        />
        <Figure
          label="Expected arrival"
          value={r.etaAtIso ? clock(r.etaAtIso) : '—'}
          sub={r.etaAtIso ? `${day(r.etaAtIso)} · IST` : 'Not reported'}
          tone={late ? h.figure : 'text-ink'}
        />
        <Figure
          label="Delay"
          value={r.delayMinutes === null ? '—' : r.delayMinutes <= 0 ? 'On time' : delayText(r.delayMinutes)}
          sub={r.delayMinutes === null ? 'Unknown' : late ? 'Behind schedule' : 'Running to schedule'}
          tone={r.delayMinutes === null ? 'text-ink' : h.figure}
        />
        <Figure
          label="Platform"
          value={r.platform ? `PF ${r.platform}` : '—'}
          sub={r.platform ? 'Announced' : 'Not announced yet'}
        />
      </div>

      {/* How fresh the reading is sits with the reading: an ETA projected
          from an hour-old position is an hour-old ETA. */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-line bg-sunken/50 px-5 py-2.5 text-xs text-muted">
        <span>
          <span className="font-medium text-ink">Feed updated </span>
          {r.providerUpdatedAtIso
            ? `${clock(r.providerUpdatedAtIso)} IST · ${ago(r.providerUpdatedAtIso)}`
            : 'never (this run has not reported yet)'}
          {r.arrived ? ' · tracking stopped' : ''}
        </span>
        <span className="text-pretty">
          Cached for <span className="font-mono">{r.trainNo}</span> at <span className="font-mono">{r.stationCode}</span>, so
          the kitchen and rider boards show the same times.
        </span>
      </div>
    </Card>
  )
}

/** A field with its icon inside the box: the form reads as one bar. */
function IconField({
  label, htmlFor, icon, children,
}: {
  label: string
  htmlFor: string
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">
        {label}
      </label>
      <div className="relative">
        <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint">
          {icon}
        </span>
        {children}
      </div>
    </div>
  )
}

export function TrainLookupForm({
  stations, today,
}: {
  stations: string[]
  today: string
}) {
  const [state, action, pending] = useActionState(lookupTrain, initial)
  // Controlled, so a submit (which resets uncontrolled fields) keeps what
  // was asked about on screen beside the answer.
  const [trainNo, setTrainNo] = useState('')
  const [station, setStation] = useState(stations[0] ?? '')
  const r = state.result

  return (
    <div className="space-y-4">
      <Card>
        <form action={action} className="space-y-3 p-4">
          <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <IconField label="Train number" htmlFor="trainNo" icon={<IconTrain size={15} />}>
              <input id="trainNo" name="trainNo" required inputMode="numeric" autoComplete="off" spellCheck={false}
                value={trainNo} onChange={(e) => setTrainNo(e.target.value.replace(/\D/g, ''))}
                placeholder="e.g. 12561" maxLength={5}
                className={`${inputClass} pl-9 font-mono tabular-nums placeholder:font-sans`} />
            </IconField>

            <IconField label="Station" htmlFor="stationCode" icon={<IconLocate size={14} />}>
              <input id="stationCode" name="stationCode" required list="station-codes" autoComplete="off" spellCheck={false}
                value={station} onChange={(e) => setStation(e.target.value.toUpperCase())}
                placeholder="e.g. CNB"
                className={`${inputClass} pl-9 font-mono uppercase placeholder:font-sans placeholder:normal-case`} />
              <datalist id="station-codes">
                {stations.map((s) => <option key={s} value={s} />)}
              </datalist>
            </IconField>

            <IconField label="Arrives on" htmlFor="serviceDate" icon={<IconCalendar size={14} />}>
              <input id="serviceDate" name="serviceDate" type="date" defaultValue={today} className={`${inputClass} pl-9`} />
            </IconField>

            <Button type="submit" pending={pending} className="w-full lg:w-auto lg:px-5">
              {pending ? null : <IconSearch size={15} aria-hidden />}
              Check status
            </Button>
          </div>

          {stations.length > 1 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs text-muted">Your outlets</span>
              {stations.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStation(s)}
                  aria-pressed={station === s}
                  className={`h-6 rounded-md px-2 font-mono text-xs font-semibold transition-colors ${focusRing} ${
                    station === s
                      ? 'bg-accent-soft text-accent ring-1 ring-inset ring-accent/30'
                      : 'bg-sunken text-muted hover:text-ink'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          ) : null}

          {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
        </form>
      </Card>

      {r ? (
        <TrainResult r={r} />
      ) : (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-line-strong bg-surface px-6 py-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-sunken text-faint">
            <IconTrain size={24} aria-hidden />
          </span>
          <p className="mt-3 font-medium text-ink">Check any train, any day</p>
          <p className="mt-1 max-w-md text-sm text-muted text-pretty">
            Enter a train number and the station it stops at to see its expected arrival, delay,
            platform and where it is right now.
          </p>
        </div>
      )}
    </div>
  )
}
