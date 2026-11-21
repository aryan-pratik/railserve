'use client'

import { useActionState, useState, type ReactNode } from 'react'
import { CalendarDays, MapPin, Search, TrainFront } from 'lucide-react'
import { Button, Card, Chip, Mono, Eyebrow, cx, v2Focus } from './ui'
import { Notice, EmptyState, KeyValue } from './Table'
import { Field, inputClass } from './SettingsForm'
import { lookupTrain, type LookupState, type TrainLookup } from '@/app/admin/trains/actions'

const initial: LookupState = {}
const IST = 'Asia/Kolkata'

const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { timeZone: IST, hour: '2-digit', minute: '2-digit', hour12: true })
const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { timeZone: IST, day: '2-digit', month: 'short' })

function serviceDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) return ymd
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
}

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins === 0) return 'moments ago'
  if (mins < 60) return `${mins} min ago`
  return `${Math.floor(mins / 60)} h ${mins % 60} min ago`
}

const delayText = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`)

/** One reading of the run, shared by the chip and the figures so they never disagree. */
function health(r: TrainLookup): { tone: 'grey' | 'ok' | 'warn' | 'bad'; label: string } {
  if (r.arrived) return { tone: 'grey', label: 'Left the station' }
  if (r.delayMinutes === null) return { tone: 'grey', label: 'Status unknown' }
  if (r.delayMinutes <= 0) return { tone: 'ok', label: 'On time' }
  if (r.delayMinutes < 30) return { tone: 'warn', label: `${delayText(r.delayMinutes)} late` }
  return { tone: 'bad', label: `${delayText(r.delayMinutes)} late` }
}

const FIGURE_TONE = { grey: 'text-v2-ink', ok: 'text-v2-ok', warn: 'text-v2-warn', bad: 'text-v2-bad' } as const

export function SettingsTrainLookup({ stations, today }: { stations: { code: string; name: string | null }[]; today: string }) {
  const [state, action, pending] = useActionState(lookupTrain, initial)
  // Controlled, so a submit (which resets uncontrolled fields) keeps what was
  // asked about on screen beside the answer.
  const [trainNo, setTrainNo] = useState('')
  const [station, setStation] = useState(stations[0]?.code ?? '')
  const r = state.result

  return (
    <div className="grid gap-3.5">
      <Card title="Look up a train">
        <form action={action} className="grid gap-3">
          <div className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <Field label="Train number" htmlFor="lookup-train">
              <div className="relative">
                <TrainFront size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-v2-faint" />
                <input
                  id="lookup-train"
                  name="trainNo"
                  required
                  inputMode="numeric"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={5}
                  value={trainNo}
                  onChange={(e) => setTrainNo(e.target.value.replace(/\D/g, ''))}
                  placeholder="e.g. 12561"
                  className={cx(inputClass, 'pl-9 font-mono tabular-nums placeholder:font-v2')}
                />
              </div>
            </Field>
            <Field label="Station" htmlFor="lookup-station">
              <div className="relative">
                <MapPin size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-v2-faint" />
                <input
                  id="lookup-station"
                  name="stationCode"
                  required
                  list="lookup-stations"
                  autoComplete="off"
                  spellCheck={false}
                  value={station}
                  onChange={(e) => setStation(e.target.value.toUpperCase())}
                  placeholder="e.g. CNB"
                  className={cx(inputClass, 'pl-9 font-mono uppercase placeholder:font-v2 placeholder:normal-case')}
                />
                <datalist id="lookup-stations">
                  {stations.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.name ?? s.code}
                    </option>
                  ))}
                </datalist>
              </div>
            </Field>
            <Field label="Arrives on" htmlFor="lookup-date">
              <div className="relative">
                <CalendarDays size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-v2-faint" />
                <input id="lookup-date" name="serviceDate" type="date" defaultValue={today} className={cx(inputClass, 'pl-9')} />
              </div>
            </Field>
            <Button type="submit" variant="primary" disabled={pending} className="w-full xl:w-auto">
              {pending ? null : <Search size={15} aria-hidden />}
              {pending ? 'Checking…' : 'Check status'}
            </Button>
          </div>

          {stations.length > 1 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs text-v2-muted">Your stations</span>
              {stations.map((s) => (
                <button
                  key={s.code}
                  type="button"
                  onClick={() => setStation(s.code)}
                  aria-pressed={station === s.code}
                  className={cx(
                    'h-7 rounded-full px-2.5 font-mono text-xs font-semibold transition-colors',
                    station === s.code ? 'bg-v2-brand-soft text-v2-brand ring-1 ring-inset ring-v2-brand/30' : 'bg-v2-surface-2 text-v2-muted hover:text-v2-ink',
                    v2Focus,
                  )}
                >
                  {s.code}
                </button>
              ))}
            </div>
          ) : null}

          {state.error ? <Notice tone="bad">{state.error}</Notice> : null}
        </form>
      </Card>

      {r ? (
        <TrainResult r={r} />
      ) : (
        <EmptyState
          title="Check any train, any day"
          note="Enter a train number and the station it stops at to see its expected arrival, delay, platform and where it is right now. A check also refreshes the times the kitchen and rider boards show."
        />
      )}
    </div>
  )
}

function Figure({ label, value, sub, tone = 'text-v2-ink' }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className="grid content-start gap-1">
      <Eyebrow>{label}</Eyebrow>
      <div className={cx('whitespace-nowrap font-mono text-[24px] font-semibold leading-none tracking-[-0.02em] tabular-nums', tone)}>{value}</div>
      <div className="min-h-4 truncate text-xs text-v2-faint">{sub}</div>
    </div>
  )
}

function TrainResult({ r }: { r: TrainLookup }) {
  const h = health(r)
  const late = r.delayMinutes !== null && r.delayMinutes > 0
  const started = Boolean(r.currentStationCode)
  const atStation = r.stopsAway === 0 || r.arrived
  const remaining = [
    r.stopsAway !== null && r.stopsAway > 0 ? `${r.stopsAway} stop${r.stopsAway === 1 ? '' : 's'} to go` : null,
    r.distanceKm !== null ? `${r.distanceKm} km into the run` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="grid gap-3.5 xl:grid-cols-[1.4fr_1fr]">
      <Card
        title={
          <span className="flex flex-wrap items-baseline gap-x-2">
            <Mono>{r.trainNo}</Mono>
            <span>{r.trainName ?? 'Train'}</span>
          </span>
        }
        action={<Chip tone={h.tone}>{h.label}</Chip>}
      >
        <p className="-mt-2 text-sm text-v2-muted">
          {serviceDay(r.serviceDate)} · at {r.stationName ?? r.stationCode} <Mono className="text-v2-faint">{r.stationCode}</Mono>
        </p>

        {r.simulated ? <Notice tone="warn">These times are simulated, not live. No real train API is configured for this environment.</Notice> : null}
        {r.statusNote ? <Notice>{r.statusNote}</Notice> : null}

        <div className="grid grid-cols-2 gap-x-4 gap-y-5 pt-1 2xl:grid-cols-4">
          <Figure label="Scheduled" value={r.scheduledArrivalIso ? clock(r.scheduledArrivalIso) : '—'} sub={r.scheduledArrivalIso ? `${day(r.scheduledArrivalIso)} · IST` : 'Not published'} />
          <Figure label="Expected" value={r.etaAtIso ? clock(r.etaAtIso) : '—'} sub={r.etaAtIso ? `${day(r.etaAtIso)} · IST` : 'Not reported'} tone={late ? FIGURE_TONE[h.tone] : 'text-v2-ink'} />
          <Figure
            label="Delay"
            value={r.delayMinutes === null ? '—' : r.delayMinutes <= 0 ? 'On time' : delayText(r.delayMinutes)}
            sub={r.delayMinutes === null ? 'Unknown' : late ? 'Behind schedule' : 'Running to schedule'}
            tone={r.delayMinutes === null ? 'text-v2-ink' : FIGURE_TONE[h.tone]}
          />
          <Figure label="Platform" value={r.platform ? `PF ${r.platform}` : '—'} sub={r.platform ? 'Announced' : 'Not announced yet'} />
        </div>
      </Card>

      <Card title="Where it is">
        <div className="grid gap-3">
          <div className="flex items-center gap-3">
            <span className="relative flex size-3 shrink-0">
              {started && !atStation ? <span className="absolute inline-flex size-full animate-ping rounded-full bg-v2-brand opacity-50 motion-reduce:animate-none" /> : null}
              <span className={cx('relative inline-flex size-3 rounded-full', started ? 'bg-v2-brand' : 'bg-v2-line-strong')} />
            </span>
            <div className="min-w-0">
              <Eyebrow>Train is now at</Eyebrow>
              <div className="truncate text-sm font-semibold">{started ? (r.currentStationName ?? r.currentStationCode) : 'Not started yet'}</div>
              {started && r.currentStationName ? <Mono className="text-xs text-v2-faint">{r.currentStationCode}</Mono> : null}
            </div>
          </div>

          <div className="grid gap-1.5">
            <div className="relative h-1.5 w-full rounded-full bg-v2-sunken">
              <div className={cx('absolute inset-y-0 left-0 rounded-full', atStation ? 'w-full bg-v2-brand' : started ? 'w-1/2 bg-v2-brand/70' : 'w-0')} />
            </div>
            <div className="text-center text-xs text-v2-muted">{atStation ? 'At your station' : remaining || 'Position not reported'}</div>
          </div>

          <div className="flex items-center gap-3">
            <span className={cx('inline-flex size-3 shrink-0 rounded-full ring-4', atStation ? 'bg-v2-brand ring-v2-brand-soft' : 'bg-v2-surface ring-v2-line-strong')} />
            <div className="min-w-0">
              <Eyebrow>Delivering at</Eyebrow>
              <div className="truncate text-sm font-semibold">{r.stationName ?? r.stationCode}</div>
              {r.stationName ? <Mono className="text-xs text-v2-faint">{r.stationCode}</Mono> : null}
            </div>
          </div>
        </div>

        <KeyValue
          className="border-t border-v2-line pt-3"
          rows={[
            {
              label: 'Feed updated',
              value: r.providerUpdatedAtIso ? `${clock(r.providerUpdatedAtIso)} IST · ${ago(r.providerUpdatedAtIso)}${r.arrived ? ' · tracking stopped' : ''}` : 'never (this run has not reported yet)',
            },
            { label: 'Cached as', value: <Mono>{`${r.trainNo} @ ${r.stationCode} · ${r.serviceDate}`}</Mono> },
          ]}
        />
      </Card>
    </div>
  )
}
