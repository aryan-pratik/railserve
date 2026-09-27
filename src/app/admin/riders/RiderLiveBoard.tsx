'use client'

import { useCallback, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import {
  BOARD_REFRESH_SECONDS,
  PRESENCE_LABEL,
  PRESENCE_NOTE,
  ageLabel,
  headingLabel,
  speedLabel,
  type Presence,
} from '@/lib/riderLocation'
import type { RiderBoard, RiderView } from '@/lib/repo/riderLocationRepo'
import {
  Card, EmptyState, Notice, Pagination, focusRing, thClass,
} from '@/components/ui'
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination'
import { useNowMs } from '@/components/useNow'
import { IconPhone, IconRefresh } from '@/components/Icons'

// Leaflet touches `window` on import, so the map must never be part of the
// server render — not lazily-if-you-like, but never.
const RiderMap = dynamic(() => import('./RiderMap').then((m) => m.RiderMap), {
  ssr: false,
  loading: () => (
    <div
      aria-busy="true"
      className="h-[26rem] w-full rounded-lg bg-sunken motion-safe:animate-pulse sm:h-[32rem]"
    />
  ),
})

/**
 * The pager's links, built here rather than handed down.
 *
 * A server component cannot pass a function across to a client one, and this
 * page's URL carries nothing but the page and its size, so there is nothing to
 * fold in — `withPage` on an empty query is the whole of it.
 */
function pageHref({ page, pageSize }: { page: number; pageSize: number }): string {
  const u = new URLSearchParams()
  if (page > 1) u.set('page', String(page))
  if (pageSize !== DEFAULT_PAGE_SIZE) u.set('pageSize', String(pageSize))
  const qs = u.toString()
  return qs ? `/admin/riders?${qs}` : '/admin/riders'
}

/** Missed polls before the screen admits it is no longer live. */
const STALE_AFTER_CYCLES = 3

const TONE: Record<Presence, string> = {
  LIVE: 'bg-emerald-50 text-emerald-900 ring-emerald-200',
  IDLE: 'bg-amber-50 text-amber-900 ring-amber-200',
  OFFLINE: 'bg-slate-100 text-slate-700 ring-slate-300',
  NEVER: 'bg-slate-100 text-slate-600 ring-slate-300',
}

const DOT: Record<Presence, string> = {
  LIVE: 'bg-emerald-500 motion-safe:animate-pulse',
  IDLE: 'bg-amber-500',
  OFFLINE: 'bg-slate-400',
  NEVER: 'bg-slate-300',
}

function PresenceBadge({ presence }: { presence: Presence }) {
  return (
    <span
      title={PRESENCE_NOTE[presence]}
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE[presence]}`}
    >
      <span aria-hidden className={`inline-block size-1.5 rounded-full ${DOT[presence]}`} />
      {PRESENCE_LABEL[presence]}
    </span>
  )
}

/**
 * The live rider board.
 *
 * Polls its own JSON and swaps the data in, rather than calling
 * router.refresh() the way the kitchen and call boards do. Those pages are
 * server-rendered lists where a full re-render is the cheapest correct thing;
 * this one holds a Leaflet map whose pan and zoom belong to the operator, and
 * re-rendering the tree under it every ten seconds would throw that away.
 *
 * There is no pause control, for the reason the other boards here don't have
 * one either: a paused board is indistinguishable from a quiet one, and keeps
 * showing positions that were true when it stopped. Instead, a board that has
 * stopped succeeding says so — in the header and, loudly, above the list.
 */
export function RiderLiveBoard({
  initial,
  page,
  pageSize,
}: {
  initial: RiderBoard
  page: number
  pageSize: number
}) {
  const [board, setBoard] = useState<RiderBoard>(initial)
  const [failing, setFailing] = useState(false)
  const [focusRiderId, setFocusRiderId] = useState<string | null>(null)
  const [lastOkAt, setLastOkAt] = useState(() => new Date(initial.fetchedAt).getTime())

  // One shared second-hand, which also re-renders the age labels between
  // polls: a board that has stopped updating then visibly ages, instead of
  // sitting frozen on a plausible-looking "8s ago". Null on the server and
  // through hydration, where the render time is the only honest clock.
  const nowMs = useNowMs(1_000)
  const now = nowMs === null ? new Date(board.fetchedAt) : new Date(nowMs)

  const poll = useCallback(async () => {
    try {
      // No serviceDate on purpose. The route reads todayIST() per request, so
      // a board left open across midnight follows the service day over instead
      // of counting yesterday's work forever — the same reason
      // /api/store/cancellations re-reads the date inside its loop.
      const res = await fetch('/api/admin/riders', { cache: 'no-store' })
      if (!res.ok) {
        setFailing(true)
        return
      }
      setBoard((await res.json()) as RiderBoard)
      setLastOkAt(Date.now())
      setFailing(false)
    } catch {
      // Offline, or the tab was backgrounded mid-request. The next tick
      // retries; the staleness clock below is what tells the operator.
      setFailing(true)
    }
  }, [])

  useEffect(() => {
    const timer = setInterval(() => void poll(), BOARD_REFRESH_SECONDS * 1000)

    // A browser throttles timers in a hidden tab, so a board left on another
    // tab comes back showing where everyone was ten minutes ago. Catch up the
    // moment it is looked at, and the moment the network returns.
    const catchUp = () => {
      if (document.visibilityState === 'visible') void poll()
    }
    document.addEventListener('visibilitychange', catchUp)
    window.addEventListener('online', catchUp)

    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', catchUp)
      window.removeEventListener('online', catchUp)
    }
  }, [poll])

  // Read off the clock, never off `failing`. A sleeping laptop, a throttled
  // background tab and a dropped request all stop the board without any fetch
  // ever reporting an error — AutoRefresh's docstring makes the same point.
  // `failing` only decides how the notice below is worded.
  const staleMs = nowMs === null ? 0 : nowMs - lastOkAt
  const stale = staleMs > BOARD_REFRESH_SECONDS * STALE_AFTER_CYCLES * 1000

  const riders = board.riders
  const live = riders.filter((r) => r.presence === 'LIVE').length
  const carrying = riders.reduce((n, r) => n + r.work.carrying, 0)
  const pageRiders = riders.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <LiveIndicator stale={stale} fetchedAt={board.fetchedAt} />
        <p className="text-sm text-muted tabular-nums">
          {live} of {riders.length} sharing now · {carrying} order{carrying === 1 ? '' : 's'} in
          riders&rsquo; hands
        </p>
        <button
          type="button"
          onClick={() => void poll()}
          className={`ml-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-sunken hover:text-ink ${focusRing}`}
        >
          <IconRefresh size={14} aria-hidden />
          Refresh now
        </button>
      </div>

      {stale ? (
        <Notice tone="warn">
          This board last reached the server{' '}
          <strong className="tabular-nums">{Math.round(staleMs / 1000)}s</strong> ago. Every
          position below is at least that old.{' '}
          {failing ? 'It keeps retrying — check your connection.' : 'Catching up…'}
        </Notice>
      ) : null}

      {riders.length === 0 ? (
        <EmptyState
          title="No riders yet"
          note="Riders appear here once a delivery agent account exists. Add one under Setup, and the map fills in as soon as they sign in to the rider app and allow location."
        />
      ) : (
        <>
          <Card className="overflow-hidden p-1">
            <RiderMap riders={riders} focusRiderId={focusRiderId} />
          </Card>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-sm">
                <thead className="border-b border-line bg-sunken">
                  <tr>
                    <th className={thClass}>Rider</th>
                    <th className={thClass}>Status</th>
                    <th className={thClass}>Last position</th>
                    <th className={thClass}>Carrying</th>
                    <th className={thClass}>Today</th>
                    <th className={thClass}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {pageRiders.map((rider) => (
                    <RiderRow
                      key={rider.id}
                      rider={rider}
                      now={now}
                      onShowOnMap={() => setFocusRiderId(rider.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="border-t border-line">
              <Pagination
                page={page}
                pageSize={pageSize}
                total={riders.length}
                buildHref={pageHref}
              />
            </div>
          </Card>
        </>
      )}
    </div>
  )
}

function RiderRow({
  rider,
  now,
  onShowOnMap,
}: {
  rider: RiderView
  now: Date
  onShowOnMap: () => void
}) {
  const pos = rider.position
  const speed = speedLabel(pos?.speedMetresPerSecond)
  const heading = headingLabel(pos?.headingDegrees)
  const coarse = pos?.accuracyMetres != null && pos.accuracyMetres > 100

  return (
    <tr className="align-top">
      <td className="px-3 py-2.5">
        <p className="font-medium text-ink">{rider.name}</p>
        {rider.phone ? (
          <a
            href={`tel:${rider.phone}`}
            className={`mt-0.5 inline-flex items-center gap-1 rounded text-xs text-muted underline-offset-2 hover:text-accent hover:underline ${focusRing}`}
          >
            <IconPhone size={12} aria-hidden />
            {rider.phone}
          </a>
        ) : null}
      </td>

      <td className="px-3 py-2.5">
        <PresenceBadge presence={rider.presence} />
      </td>

      <td className="px-3 py-2.5">
        {pos ? (
          <>
            <p className="tabular-nums text-ink">{ageLabel(pos.recordedAt, now)}</p>
            <p className="text-xs text-muted">
              {[speed, heading, pos.accuracyMetres ? `±${Math.round(pos.accuracyMetres)}m` : null]
                .filter(Boolean)
                .join(' · ') || '—'}
            </p>
            {coarse ? (
              // Worth saying out loud: at this radius the dot is the
              // neighbourhood, not the platform.
              <p className="text-xs text-amber-800">Approximate — no satellite fix</p>
            ) : null}
          </>
        ) : (
          <p className="text-xs text-muted">{PRESENCE_NOTE.NEVER}</p>
        )}
      </td>

      <td className="px-3 py-2.5">
        {rider.work.carrying > 0 ? (
          <>
            <p className="font-medium tabular-nums text-ink">{rider.work.carrying}</p>
            {rider.work.trains.length > 0 ? (
              <p className="text-xs text-muted">{rider.work.trains.join(', ')}</p>
            ) : null}
          </>
        ) : (
          <p className="text-xs text-muted">Nothing</p>
        )}
      </td>

      <td className="px-3 py-2.5">
        <p className="tabular-nums text-ink">
          {rider.work.delivered} delivered
          {rider.work.failed > 0 ? `, ${rider.work.failed} failed` : ''}
        </p>
        {rider.work.lastDeliveredAt ? (
          <p className="text-xs text-muted">last {ageLabel(rider.work.lastDeliveredAt, now)}</p>
        ) : null}
      </td>

      <td className="px-3 py-2.5 text-right">
        <div className="flex flex-col items-end gap-1">
          {pos ? (
            <button
              type="button"
              onClick={onShowOnMap}
              className={`rounded px-1 text-xs font-medium text-accent underline-offset-2 hover:underline ${focusRing}`}
            >
              Show on map
            </button>
          ) : null}
          <Link
            href={`/admin/setup?tab=staff&edit=${rider.id}`}
            className={`rounded px-1 text-xs text-muted underline-offset-2 hover:text-ink hover:underline ${focusRing}`}
          >
            Account
          </Link>
        </div>
      </td>
    </tr>
  )
}

/** The same green-dot-and-timestamp vocabulary the other live boards use. */
function LiveIndicator({ stale, fetchedAt }: { stale: boolean; fetchedAt: string }) {
  const at = new Date(fetchedAt).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })

  return (
    <span
      className={`inline-flex h-7 items-center gap-1.5 px-1 text-xs font-medium ${
        stale ? 'text-amber-800' : 'text-muted'
      }`}
      title={`Positions refresh every ${BOARD_REFRESH_SECONDS} seconds`}
    >
      <span
        aria-hidden
        className={`inline-block size-1.5 rounded-full ${
          stale ? 'bg-amber-500' : 'bg-emerald-500 motion-safe:animate-pulse'
        }`}
      />
      <span className="tabular-nums">
        {stale ? 'Not updating' : `Live · every ${BOARD_REFRESH_SECONDS}s`} · {at}
      </span>
    </span>
  )
}
