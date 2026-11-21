import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'
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
  /** Makes the whole card a fold toggle: tap anywhere on it to open or close the orders under it. */
  fold?: { open: boolean; onToggle: () => void; controls: string }
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
  const fold = p.fold
  // A tap on the card toggles it, except on its own buttons, links and menus.
  const onClick = fold
    ? (e: MouseEvent<HTMLElement>) => {
        if ((e.target as HTMLElement).closest('a,button,summary,details,input,select,label,[role=listbox]')) return
        fold.onToggle()
      }
    : undefined

  return (
    <Tag
      href={p.href}
      onClick={onClick}
      onKeyDown={
        fold
          ? (e: KeyboardEvent<HTMLElement>) => {
              if (e.target !== e.currentTarget) return
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                fold.onToggle()
              }
            }
          : undefined
      }
      role={fold ? 'button' : undefined}
      tabIndex={fold ? 0 : undefined}
      aria-expanded={fold ? fold.open : undefined}
      aria-controls={fold ? fold.controls : undefined}
      title={fold ? (fold.open ? 'Tap to hide the orders' : 'Tap to show the orders') : undefined}
      className={cx(
        'grid min-w-0 grid-cols-[64px_minmax(0,1fr)] overflow-hidden rounded-v2-lg border border-v2-line bg-v2-surface sm:grid-cols-[76px_minmax(0,1fr)]',
        (p.href || fold) && 'cursor-pointer transition-colors hover:bg-v2-surface-2',
        fold && 'select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-brand',
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
              {p.platform ? ` · Platform ${p.platform}` : ''}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] text-v2-ink-2">
            <span className="font-semibold">{countSentence(p.counts, total)}</span>
            {p.summary ? <span className="basis-full text-v2-muted">{p.summary}</span> : null}
          </div>
        </div>

        <div className="col-span-2 min-w-0 md:col-span-1 md:text-right">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 md:justify-end">
            <span className="text-[12px] font-semibold text-v2-muted">Arrives</span>
            {booked ? <s className="font-mono text-sm text-v2-faint">{formatTimeIST(booked)}</s> : null}
            <Mono className="text-[20px] font-semibold leading-none">{p.etaIso ? formatTimeIST(p.etaIso) : '—'}</Mono>
            {late && late !== 'on time' ? <span className="rounded-full bg-v2-bad-bg px-2 py-0.5 text-[12.5px] font-bold text-v2-bad">{late}</span> : null}
          </div>
          {p.trackingNote ? <div className="mt-0.5 truncate text-[12.5px] text-v2-muted">{p.trackingNote}</div> : null}
        </div>

        {p.actions ? <div className="flex shrink-0 items-center gap-1 self-center">{p.actions}</div> : null}
      </div>
    </Tag>
  )
}

/**
 * The train's orders in one short sentence, in the order the kitchen works:
 * "3 orders · 1 new, 2 cooking". Words, not coloured squares, so nobody has
 * to learn a legend.
 */
function countSentence(c: { fresh: number; cooking: number; ready: number; out: number; closed: number }, total: number): string {
  const parts = [
    c.fresh ? `${c.fresh} new` : null,
    c.cooking ? `${c.cooking} cooking` : null,
    c.ready ? `${c.ready} ready` : null,
    c.out ? `${c.out} with rider` : null,
    c.closed ? `${c.closed} done` : null,
  ].filter(Boolean)
  return `${total} order${total === 1 ? '' : 's'}${parts.length ? ` · ${parts.join(', ')}` : ''}`
}
