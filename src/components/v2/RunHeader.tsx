import type { ReactNode } from 'react'
import { CountdownBand } from './Countdown'
import { Mono, cx } from './ui'
import { formatTimeIST } from '@/lib/format'
import { delayLabel } from '@/lib/v2/urgency'

export type RunHeaderProps = {
  trainLabel: string
  trainName?: string | null
  stationCode: string
  /** "Started 20 Nov" when the run began on another day. */
  startDateLabel?: string | null
  /** Live or scheduled arrival, ISO. */
  etaIso: string | null
  /** The time the orders were booked against, when it differs from the ETA. */
  bookedIso?: string | null
  platform?: string | null
  delayMinutes?: number | null
  arrived?: boolean
  serverNowMs: number
  /** Status squares: new / cooking / ready / out / closed counts. */
  counts: { fresh: number; cooking: number; ready: number; out: number; closed: number }
  /** Short line under the train: "1 order · 1 on the way", "leave by 14:36". */
  summary?: string | null
  /** Under the ETA: "arrived · tracking stopped", "checked 14:20 · next 15:20". */
  trackingNote?: string | null
  /** Buttons on the right (refresh, copy, collapse). */
  actions?: ReactNode
  href?: string
  className?: string
}

/**
 * The departure-board strip for one train run, in the shape the kitchen
 * already knows from v1: a coloured countdown band on the left (green = time
 * in hand, amber = cook now, red = at the door), the train in the middle, the
 * ETA with its delay on the right. Same component on the dashboard, the
 * orders table in grouped mode, the kitchen board and the call board.
 */
export function RunHeader(p: RunHeaderProps) {
  const booked = p.bookedIso && p.etaIso && Math.abs(Date.parse(p.bookedIso) - Date.parse(p.etaIso)) > 60_000 ? p.bookedIso : null
  const late = delayLabel(p.delayMinutes)
  const total = p.counts.fresh + p.counts.cooking + p.counts.ready + p.counts.out + p.counts.closed
  const Tag = p.href ? 'a' : 'div'

  return (
    <Tag
      href={p.href}
      className={cx(
        'grid grid-cols-[76px_minmax(0,1fr)] overflow-hidden rounded-v2-lg border border-v2-line bg-v2-surface',
        p.href && 'transition-colors hover:bg-v2-surface-2',
        p.className,
      )}
    >
      <CountdownBand targetIso={p.etaIso} arrived={p.arrived} serverNowMs={p.serverNowMs} className="min-h-full" />
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 md:grid-cols-[minmax(0,1.6fr)_minmax(150px,auto)_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="font-mono text-[20px] font-semibold leading-none tabular-nums">{p.trainLabel}</span>
            {p.startDateLabel ? <span className="rounded-md bg-v2-surface-2 px-1.5 py-0.5 text-[11px] font-semibold text-v2-muted ring-1 ring-inset ring-v2-line">{p.startDateLabel}</span> : null}
            <span className="truncate text-[15px] font-semibold text-v2-ink-2">{p.trainName ?? 'Train'}</span>
            <span className="text-[13px] text-v2-muted">
              {p.stationCode}
              {p.platform ? ` · PF ${p.platform}` : ''}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-v2-muted">
            <span className="font-bold tabular-nums text-v2-ink">{total}</span>
            <span className="flex flex-wrap gap-1" aria-label={`${p.counts.fresh} new, ${p.counts.cooking} cooking, ${p.counts.ready} ready, ${p.counts.out} out, ${p.counts.closed} closed`}>
              {squares(p.counts.fresh, 'bg-v2-info')}
              {squares(p.counts.cooking, 'bg-v2-soon')}
              {squares(p.counts.ready, 'bg-v2-brand')}
              {squares(p.counts.out, 'bg-v2-brand-deep')}
              {squares(p.counts.closed, 'bg-v2-line-strong')}
            </span>
            {p.summary ? <span className="truncate">{p.summary}</span> : null}
          </div>
        </div>

        <div className="col-span-2 min-w-0 md:col-span-1 md:text-right">
          <div className="flex flex-wrap items-baseline gap-x-2 md:justify-end">
            <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-v2-faint">ETA</span>
            {booked ? <s className="font-mono text-sm text-v2-faint">{formatTimeIST(booked)}</s> : null}
            <Mono className="text-[20px] font-semibold leading-none">{p.etaIso ? formatTimeIST(p.etaIso) : '—'}</Mono>
            {late && late !== 'on time' ? <span className="text-[13px] font-bold text-v2-over">{late}</span> : null}
          </div>
          {p.trackingNote ? <div className="mt-0.5 truncate text-[12.5px] text-v2-muted">{p.trackingNote}</div> : null}
        </div>

        {p.actions ? <div className="flex shrink-0 items-center gap-1 self-center">{p.actions}</div> : null}
      </div>
    </Tag>
  )
}

/** Up to 12 squares per bucket; beyond that one square with a count keeps the strip short. */
function squares(n: number, colour: string) {
  if (n <= 0) return null
  if (n > 12) {
    return (
      <span key={colour} className={cx('inline-flex h-2.5 items-center rounded-[3px] px-1 font-mono text-[9px] font-bold leading-none text-white', colour)}>
        {n}
      </span>
    )
  }
  return Array.from({ length: n }, (_, i) => <i key={`${colour}${i}`} className={cx('inline-block h-2.5 w-2.5 rounded-[3px]', colour)} />)
}
