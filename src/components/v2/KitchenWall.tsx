'use client'

import Link from 'next/link'
import { X } from 'lucide-react'
import { useNowMs } from '@/components/useNow'
import { formatTimeIST } from '@/lib/format'
import type { KitchenOrder, KitchenRun } from '@/lib/v2/kitchenView'
import { countdownLabel, minutesUntil, urgencyFor, URGENCY_FILL } from '@/lib/v2/urgency'
import { cx, v2Focus } from './ui'
import { KitchenDietMarks } from './KitchenBits'
import { KitchenLive } from './KitchenLive'
import { KitchenTicketAction, type RunActionContext } from './KitchenRunActions'

/*
 * Wall mode: the board as a screen on the kitchen wall reads it, from three
 * metres away and with wet hands. Always dark, so the colour literals here
 * are local to this surface. Columns are trains in arrival order, tickets
 * are orders, every tap target is at least 48px and nothing is smaller than
 * 18px. It covers the shell (fixed, above the sidebar) and the X returns to
 * the desk at the same filters.
 */

const WALL_BG = 'bg-[#0d1210]'
const TICKET_BG = 'bg-[#151d19]'
const LIVE = new Set(['RECEIVED', 'ACCEPTED', 'KOT_PRINTED', 'PREPARED'])

export function KitchenWall({
  runs,
  riders,
  serverNowMs,
  renderedAt,
  delayThresholdMinutes,
  deskHref,
  title,
}: {
  runs: KitchenRun[]
  riders: { id: string; name: string }[]
  serverNowMs: number
  renderedAt: string
  delayThresholdMinutes: number
  deskHref: string
  title: string
}) {
  const open = runs.reduce((n, r) => n + r.orders.filter((o) => LIVE.has(o.status)).length, 0)
  return (
    <div className={cx('fixed inset-0 z-50 grid grid-rows-[auto_minmax(0,1fr)] font-v2 text-white antialiased', WALL_BG)}>
      <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-white/10 px-5 py-3">
        <h1 className="text-[22px] font-bold tracking-[-0.02em]">{title}</h1>
        <span className="text-[18px] text-white/60">
          {runs.length} train{runs.length === 1 ? '' : 's'} · {open} open
        </span>
        <div className="ml-auto flex items-center gap-4">
          <KitchenLive renderedAt={renderedAt} dark />
          <Link
            href={deskHref}
            className={cx('grid h-12 w-12 place-items-center rounded-full border border-white/20 text-white hover:bg-white/10', v2Focus)}
            aria-label="Leave wall mode"
            title="Back to the desk"
          >
            <X size={22} aria-hidden />
          </Link>
        </div>
      </header>

      {runs.length === 0 ? (
        <div className="grid place-items-center p-10 text-center">
          <p className="text-[24px] font-bold">Nothing on the board</p>
          <p className="mt-2 text-[18px] text-white/60">New orders appear here the moment they arrive, grouped by train.</p>
        </div>
      ) : (
        <div className="flex min-h-0 gap-4 overflow-x-auto overflow-y-hidden p-4 [scrollbar-color:rgba(255,255,255,0.25)_transparent]">
          {runs.map((run) => (
            <WallColumn key={run.key} run={run} riders={riders} serverNowMs={serverNowMs} delayThresholdMinutes={delayThresholdMinutes} />
          ))}
        </div>
      )}
    </div>
  )
}

function WallColumn({
  run,
  riders,
  serverNowMs,
  delayThresholdMinutes,
}: {
  run: KitchenRun
  riders: { id: string; name: string }[]
  serverNowMs: number
  delayThresholdMinutes: number
}) {
  const ctx: RunActionContext = {
    runKey: run.key,
    trainLabel: run.trainLabel,
    delayMinutes: run.delayMinutes,
    etaIso: run.etaIso,
    delayThresholdMinutes,
    riders,
    kotHref: `/v2/kitchen/kot/${encodeURIComponent(run.key)}`,
  }
  // Open work first, in pipeline order, so the top of a column is what the
  // kitchen touches next; everything out or closed sinks to the bottom.
  const rank = (s: string) => ['RECEIVED', 'ACCEPTED', 'KOT_PRINTED', 'PREPARED', 'DISPATCHED'].indexOf(s)
  const orders = [...run.orders].sort((a, b) => (rank(a.status) === -1 ? 9 : rank(a.status)) - (rank(b.status) === -1 ? 9 : rank(b.status)))

  return (
    <section className="flex w-[380px] shrink-0 flex-col gap-3" aria-label={`${run.trainLabel} ${run.trainName ?? ''}`}>
      <header className="grid gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-mono text-[30px] font-semibold leading-none tabular-nums">{run.trainLabel}</span>
          <WallCountdown targetIso={run.etaIso} arrived={run.arrived} serverNowMs={serverNowMs} />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[18px] leading-tight">
          <span className="truncate text-white/80">{run.local ? 'Local orders' : (run.trainName ?? 'Train')}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[18px] tabular-nums text-white/70">
          <span className="rounded-lg bg-v2-platform px-2.5 py-0.5 font-sans font-bold text-white">PF {run.platform ?? '—'}</span>
          <span>ETA {run.etaIso ? formatTimeIST(run.etaIso) : '—'}</span>
          {run.delayMinutes && run.delayMinutes > 5 ? <span className="font-sans font-bold text-v2-urgent">+{run.delayMinutes} min</span> : null}
          {run.leaveByIso && !run.arrived ? <span>leave {formatTimeIST(run.leaveByIso)}</span> : null}
        </div>
      </header>
      <div className="grid min-h-0 content-start gap-3 overflow-y-auto pb-6 pr-1 [scrollbar-color:rgba(255,255,255,0.25)_transparent]">
        {orders.map((o) => (
          <WallTicket key={o.id} o={o} ctx={ctx} serverNowMs={serverNowMs} delayThresholdMinutes={delayThresholdMinutes} />
        ))}
      </div>
    </section>
  )
}

/** The "arrives in" chip at wall size; the same clock and colours as Countdown. */
function WallCountdown({ targetIso, arrived, serverNowMs }: { targetIso: string | null; arrived: boolean; serverNowMs: number }) {
  const now = useNowMs(15_000) ?? serverNowMs
  const minutes = minutesUntil(targetIso, now)
  return (
    <span className={cx('inline-flex items-center rounded-lg px-3 py-1 font-mono text-[18px] font-semibold tabular-nums', URGENCY_FILL[urgencyFor(minutes, arrived)])}>
      {countdownLabel(minutes, arrived)}
    </span>
  )
}

function WallTicket({
  o,
  ctx,
  serverNowMs,
  delayThresholdMinutes,
}: {
  o: KitchenOrder
  ctx: RunActionContext
  serverNowMs: number
  delayThresholdMinutes: number
}) {
  const now = useNowMs(15_000) ?? serverNowMs
  const age = Math.max(0, Math.floor((now - Date.parse(o.receivedAtIso)) / 60_000))
  const live = LIVE.has(o.status)
  const lateAge = live && age >= delayThresholdMinutes
  const seat = o.handoverPoint ? o.handoverPoint : o.coach ? `${o.coach}·${o.berth ?? ''}` : (o.rawSeat ?? '—')
  const word =
    o.status === 'RECEIVED' ? 'New' : o.status === 'ACCEPTED' ? 'Accepted' : o.status === 'KOT_PRINTED' ? 'Cooking' : o.status === 'PREPARED' ? 'Ready' : o.status === 'DISPATCHED' ? 'Out' : o.status.toLowerCase()

  return (
    <article className={cx('grid min-w-0 gap-3 rounded-2xl border p-4', TICKET_BG, live ? 'border-white/10' : 'border-white/5 opacity-60')} aria-label={`Order ${o.externalOrderId}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-mono text-[24px] font-semibold leading-none tabular-nums">{seat}</div>
          <div className="mt-1.5 truncate text-[18px] text-white/70">
            {o.contactName ?? o.externalOrderId}
            {o.pax ? ` · ${o.pax} pax` : ''}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={cx('font-mono text-[22px] font-semibold leading-none tabular-nums', lateAge ? 'text-[#ff6b5e]' : 'text-white/80')} title="Minutes since the order came in">
            {age}&prime;
          </div>
          <div className={cx('mt-1.5 text-[16px] font-bold', o.status === 'PREPARED' ? 'text-v2-mint' : 'text-white/60')}>{word}</div>
        </div>
      </div>

      <ul className="grid gap-1.5 text-[18px] leading-snug">
        {o.pax && o.itemNames.length === 0 ? <li className="font-semibold">{o.pax} pax thali</li> : null}
        {o.itemNames.map((name, i) => (
          <li key={`${name}-${i}`} className="flex items-start gap-2">
            {i === 0 ? <KitchenDietMarks diet={o.diet} className="mt-[7px]" /> : <span className="w-[14px] shrink-0" aria-hidden />}
            <span className="min-w-0 break-words font-semibold">{name}</span>
          </li>
        ))}
        {!o.pax && o.itemNames.length === 0 ? <li className="text-white/50">No items</li> : null}
      </ul>

      {o.note ? <p className="rounded-xl bg-v2-soon/15 px-3 py-2 text-[18px] font-semibold leading-snug text-v2-soon">{o.note}</p> : null}

      <div className="flex min-w-0 items-center justify-between gap-3 text-[16px] text-white/60">
        <span className="min-w-0 truncate">
          <span className="font-mono tabular-nums">{o.externalOrderId}</span>
          {o.outletName ? <span className="text-white/50"> · {o.outletName}</span> : null}
        </span>
        {o.paymentMode === 'COD' ? <span className="shrink-0 rounded-md bg-v2-cod-bg px-2 py-0.5 font-bold text-v2-cod">COD</span> : null}
      </div>

      {live ? <KitchenTicketAction run={ctx} order={{ id: o.id, status: o.status }} /> : null}
    </article>
  )
}
