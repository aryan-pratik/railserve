'use client'

import {
  useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode,
} from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  BOARD_REFRESH_SECONDS,
  PRESENCE_NOTE,
  ageLabel,
  headingLabel,
  speedLabel,
} from '@/lib/riderLocation'
import type { RiderBoard, RiderView } from '@/lib/repo/riderLocationRepo'
import {
  ButtonLink, Card, EmptyState, Notice, PageHeader, Pagination, focusRing, inputBase,
} from '@/components/ui'
import { readPage, withPage } from '@/lib/pagination'
import { formatRupees } from '@/lib/format'
import { useNowMs } from '@/components/useNow'
import {
  IconBag, IconCalendar, IconCash, IconExpand, IconLocate, IconMore, IconPhone, IconPlus,
  IconRefresh, IconRupee, IconSearch, IconShrink, IconUsers, IconWallet,
} from '@/components/Icons'
import {
  BOARD_STATUS,
  BOARD_STATUS_LABEL,
  STATUS_TONE,
  boardStatusOf,
  initialsOf,
  statusLabelOf,
  type BoardStatus,
} from './riderStatus'

// Leaflet touches `window` on import, so the map must never be part of the
// server render — not lazily-if-you-like, but never.
const RiderMap = dynamic(() => import('./RiderMap').then((m) => m.RiderMap), {
  ssr: false,
  loading: () => (
    <div aria-busy="true" className="h-full w-full bg-sunken motion-safe:animate-pulse" />
  ),
})

/** Missed polls before the screen admits it is no longer live. */
const STALE_AFTER_CYCLES = 3

type Filter = 'ALL' | BoardStatus

const FILTER_PARAM: Record<Filter, string | null> = {
  ALL: null,
  ONLINE: 'online',
  ON_DELIVERY: 'on-delivery',
  IDLE: 'idle',
  OFFLINE: 'offline',
}

function readFilter(value: string | null): Filter {
  const hit = (Object.keys(FILTER_PARAM) as Filter[]).find((f) => FILTER_PARAM[f] === value)
  return hit ?? 'ALL'
}

/**
 * The live rider board: the day's five figures, then the map and
 * the roster side by side on a wide screen, stacked on anything narrower.
 *
 * The map and the roster are one instrument — the locate button in a row
 * moves the map, a marker click lights up its row — so whenever they stack,
 * locating a rider scrolls the map
 * back into view rather than changing something off-screen.
 *
 * Polls its own JSON and swaps the data in, rather than calling
 * router.refresh() the way the kitchen and call boards do. Those pages are
 * server-rendered lists where a full re-render is the cheapest correct thing;
 * this one holds a Leaflet map whose pan and zoom belong to the operator, and
 * re-rendering the tree under it every few seconds would throw that away.
 *
 * The roster's filters live in the URL, written with history.replaceState so
 * that typing in the search box filters in place instead of asking the
 * server for a page it already has. Every rider is already on the client;
 * filtering and paging are a slice of that list. The date is the one filter
 * that does go to the server — a different day is a different set of orders.
 *
 * There is no pause control, for the reason the other boards here don't have
 * one either: a paused board is indistinguishable from a quiet one, and keeps
 * showing positions that were true when it stopped. Instead, a board that has
 * stopped succeeding says so — in the header and, loudly, above the figures.
 */
export function RiderLiveBoard({
  initial,
  today,
  note,
}: {
  initial: RiderBoard
  /** Today's service date in IST, so the date filter knows what "today" is. */
  today: string
  note: string
}) {
  const router = useRouter()
  const [board, setBoard] = useState<RiderBoard>(initial)
  const [failing, setFailing] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // A counter, not just an id: asking for the same rider twice — after the
  // operator has panned away — has to move the map again.
  const [focusRequest, setFocusRequest] = useState<{ id: string; n: number } | null>(null)
  const [lastOkAt, setLastOkAt] = useState(() => new Date(initial.fetchedAt).getTime())
  const mapPane = useRef<HTMLDivElement | null>(null)

  const params = useSearchParams()
  const { page, pageSize } = readPage(Object.fromEntries(params))
  const filter = readFilter(params.get('status'))
  const station = params.get('station') ?? ''
  // The box is its own state so typing never waits on the URL; the URL
  // follows it, and is what a reload or a shared link restores.
  const [query, setQuery] = useState(() => params.get('q') ?? '')

  // The server already picked the date; the client only needs it to poll
  // for the same one.
  const serviceDate = board.serviceDate
  const isToday = serviceDate === today

  // One shared second-hand, which also re-renders the age labels between
  // polls: a board that has stopped updating then visibly ages, instead of
  // sitting frozen on a plausible-looking "8s ago". Null on the server and
  // through hydration, where the render time is the only honest clock.
  const nowMs = useNowMs(1_000)
  const now = nowMs === null ? new Date(board.fetchedAt) : new Date(nowMs)

  const poll = useCallback(async () => {
    try {
      // Today is asked for by omission: the route reads todayIST() per
      // request, so a board left open across midnight follows the service day
      // over instead of counting yesterday's work forever — the same reason
      // /api/store/cancellations re-reads the date inside its loop.
      const url = isToday ? '/api/admin/riders' : `/api/admin/riders?serviceDate=${serviceDate}`
      const res = await fetch(url, { cache: 'no-store' })
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
  }, [isToday, serviceDate])

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

  /** Rewrite the roster's URL in place; any filter change starts again at page one. */
  const setParams = useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(params)
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value)
        else next.delete(key)
      }
      next.delete('page')
      const qs = next.toString()
      window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname)
    },
    [params],
  )

  /** The date is server-side: a real navigation, keeping the other filters. */
  const setDate = (date: string) => {
    const next = new URLSearchParams(params)
    if (date && date !== today) next.set('date', date)
    else next.delete('date')
    next.delete('page')
    const qs = next.toString()
    router.push(qs ? `/admin/riders?${qs}` : '/admin/riders')
  }

  const onSearch = (value: string) => {
    setQuery(value)
    setParams({ q: value.trim() || null })
  }

  const showOnMap = useCallback((id: string) => {
    setSelectedId(id)
    setFocusRequest((prev) => ({ id, n: (prev?.n ?? 0) + 1 }))

    // Stacked, the map may be a screen above the row that was tapped. Only
    // scroll when it is actually out of sight; side by side it never is.
    const pane = mapPane.current
    if (!pane) return
    const box = pane.getBoundingClientRect()
    if (box.top < 0 || box.top > window.innerHeight * 0.5) {
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      pane.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' })
    }
  }, [])

  // A marker was clicked: light up its row, if that row is on this page.
  const selectFromMap = useCallback((id: string) => {
    setSelectedId(id)
    document.getElementById(`rider-${id}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [])

  // Read off the clock, never off `failing`. A sleeping laptop, a throttled
  // background tab and a dropped request all stop the board without any fetch
  // ever reporting an error — AutoRefresh's docstring makes the same point.
  // `failing` only decides how the notice below is worded.
  const staleMs = nowMs === null ? 0 : nowMs - lastOkAt
  const stale = staleMs > BOARD_REFRESH_SECONDS * STALE_AFTER_CYCLES * 1000

  const riders = board.riders

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { ALL: riders.length, ONLINE: 0, ON_DELIVERY: 0, IDLE: 0, OFFLINE: 0 }
    for (const r of riders) c[boardStatusOf(r)] += 1
    return c
  }, [riders])

  const stations = useMemo(
    () => [...new Set(riders.flatMap((r) => r.work.stations))].sort(),
    [riders],
  )

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const digits = needle.replace(/\D/g, '')
    return riders.filter((r) => {
      if (filter !== 'ALL' && boardStatusOf(r) !== filter) return false
      if (station && !r.work.stations.includes(station)) return false
      if (!needle) return true
      return (
        r.name.toLowerCase().includes(needle) ||
        (digits.length > 0 && r.phone.replace(/\D/g, '').includes(digits)) ||
        r.work.stations.some((s) => s.toLowerCase() === needle)
      )
    })
  }, [riders, filter, station, query])

  const pageRiders = visible.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize)
  const filtered = filter !== 'ALL' || station !== '' || query.trim() !== ''

  // The pager navigates for real, so it carries the filters along with it.
  const pageHref = ({ page: p, pageSize: size }: { page: number; pageSize: number }) => {
    const qs = withPage(new URLSearchParams(params), { page: p, pageSize: size }).toString()
    return qs ? `/admin/riders?${qs}` : '/admin/riders'
  }

  return (
    // Side by side, the board is exactly one screen tall: the page does not
    // scroll, the roster does, inside its own card. Stacked, it is an
    // ordinary page. 3rem is the shell's vertical padding at that width.
    //
    // Two elements, not one: a container query answers for the nearest
    // *ancestor* container, so the element carrying @container cannot size
    // itself by its own width. The outer div is the yardstick, the inner
    // one is measured against it.
    <div className="@container/board">
    <div className="flex min-h-0 flex-col gap-5 @[60rem]/board:h-[calc(100dvh-3rem)]">
      <PageHeader
        title="Riders"
        note={note}
        action={
          <>
            <LiveIndicator stale={stale} />
            <button
              type="button"
              onClick={() => void poll()}
              aria-label="Refresh now"
              title="Refresh now"
              className={`inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-surface text-muted transition-colors hover:bg-sunken hover:text-ink active:scale-[0.97] ${focusRing}`}
            >
              <IconRefresh size={16} aria-hidden />
            </button>
            <ButtonLink href="/admin/setup?tab=staff" variant="primary">
              <IconPlus size={16} aria-hidden />
              Add rider
            </ButtonLink>
          </>
        }
      />

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
          <Figures board={board} count={counts.ALL} />

          {/* Side by side once the board itself has the room, measured on
              the board rather than the window: the sidebar, expanded or
              collapsed, takes a different bite out of the same screen. The
              map column is a fixed width, so nothing in the roster — a long
              name, an empty state, a wrapped filter row — can move it. */}
          <div className="grid min-h-0 flex-1 gap-4 @[60rem]/board:min-h-[24rem] @[60rem]/board:grid-cols-[24rem_minmax(0,1fr)] @[60rem]/board:grid-rows-[minmax(0,1fr)]">
            <div ref={mapPane} className="min-h-0 min-w-0 scroll-mt-4">
              <MapCard
                riders={riders}
                counts={counts}
                selectedId={selectedId}
                focusRequest={focusRequest}
                onSelect={selectFromMap}
              />
            </div>

            <Card className="@container flex min-h-0 min-w-0 flex-col overflow-hidden">
              <div className="shrink-0 space-y-3 p-3 sm:p-4">
                <StatusTabs
                  counts={counts}
                  active={filter}
                  onChange={(f) => setParams({ status: FILTER_PARAM[f] })}
                />
                <div className="grid grid-cols-2 gap-2 @xl:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
                  <label className="relative col-span-2 min-w-0 @xl:col-span-1">
                    <span className="sr-only">Search riders</span>
                    <IconSearch
                      size={16}
                      aria-hidden
                      className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
                    />
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => onSearch(e.target.value)}
                      placeholder="Search rider name, phone or station code"
                      autoComplete="off"
                      className={`${inputBase} w-full pl-9`}
                    />
                  </label>
                  <label>
                    <span className="sr-only">Station</span>
                    <select
                      value={station}
                      onChange={(e) => setParams({ station: e.target.value || null })}
                      className={`${inputBase} w-full`}
                    >
                      <option value="">All stations</option>
                      {stations.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="sr-only">Status</span>
                    <select
                      value={filter}
                      onChange={(e) => setParams({ status: FILTER_PARAM[e.target.value as Filter] })}
                      className={`${inputBase} w-full`}
                    >
                      <option value="ALL">All status</option>
                      {BOARD_STATUS.map((s) => (
                        <option key={s} value={s}>
                          {BOARD_STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="relative col-span-2 @xl:col-span-1">
                    <span className="sr-only">Service date</span>
                    <IconCalendar
                      size={15}
                      aria-hidden
                      className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
                    />
                    <input
                      type="date"
                      value={serviceDate}
                      max={today}
                      onChange={(e) => setDate(e.target.value)}
                      className={`${inputBase} w-full pl-9`}
                    />
                  </label>
                </div>
              </div>

              {visible.length === 0 ? (
                <div className="flex-1 border-t border-line px-4 py-10 text-center">
                  <p className="font-medium text-ink">No riders match</p>
                  <p className="mt-1 text-sm text-muted">
                    Nobody on {isToday ? 'today’s' : 'this day’s'} roster fits these filters.
                  </p>
                  {filtered ? (
                    <button
                      type="button"
                      onClick={() => {
                        setQuery('')
                        setParams({ status: null, station: null, q: null })
                      }}
                      className={`mt-3 rounded-md px-2 py-1 text-sm font-medium text-accent hover:underline ${focusRing}`}
                    >
                      Clear filters
                    </button>
                  ) : null}
                </div>
              ) : (
                <>
                  {/* The card's width, not the window's, decides table or
                      cards: side by side with the map on a wide screen the
                      roster is narrower than it is stacked on a laptop. */}
                  <RosterTable
                    riders={pageRiders}
                    now={now}
                    selectedId={selectedId}
                    onShowOnMap={showOnMap}
                  />
                  <RosterCards
                    riders={pageRiders}
                    now={now}
                    selectedId={selectedId}
                    onShowOnMap={showOnMap}
                  />
                </>
              )}

              <div className="shrink-0 border-t border-line">
                <Pagination
                  page={page}
                  pageSize={pageSize}
                  total={visible.length}
                  buildHref={pageHref}
                />
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
    </div>
  )
}

/* ── figures ─────────────────────────────────────────────────────────────── */

/** Five tiles: an icon, the figure's name, and the figure. */
function Figures({ board, count }: { board: RiderBoard; count: number }) {
  const { orders, codOrders, codPaise, amountPaise } = board.totals
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      <Figure
        icon={<IconUsers size={20} aria-hidden />}
        tint="bg-accent-soft text-accent"
        label="Total riders"
        value={String(count)}
        className="col-span-2 sm:col-span-1"
      />
      <Figure
        icon={<IconBag size={20} aria-hidden />}
        tint="bg-orange-50 text-orange-600"
        label="Total orders"
        value={String(orders)}
      />
      <Figure
        icon={<IconCash size={20} aria-hidden />}
        tint="bg-emerald-50 text-emerald-700"
        label="COD orders"
        value={String(codOrders)}
      />
      <Figure
        icon={<IconRupee size={20} aria-hidden />}
        tint="bg-amber-50 text-amber-700"
        label="COD amount"
        value={formatRupees(codPaise)}
      />
      <Figure
        icon={<IconWallet size={20} aria-hidden />}
        tint="bg-accent-soft text-accent"
        label="Total order amount"
        value={formatRupees(amountPaise)}
      />
    </div>
  )
}

function Figure({
  icon,
  tint,
  label,
  value,
  className = '',
}: {
  icon: ReactNode
  tint: string
  label: string
  value: string
  className?: string
}) {
  return (
    <Card className={`flex items-center gap-3 px-4 py-3.5 ${className}`}>
      <span className={`inline-flex size-10 shrink-0 items-center justify-center rounded-lg ${tint}`}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-muted">{label}</p>
        <p className="mt-0.5 truncate text-2xl leading-none font-semibold tracking-tight text-ink tabular-nums">
          {value}
        </p>
      </div>
    </Card>
  )
}

/* ── map ─────────────────────────────────────────────────────────────────── */

const noSubscribe = () => () => {}

function MapCard({
  riders,
  counts,
  selectedId,
  focusRequest,
  onSelect,
}: {
  riders: RiderView[]
  counts: Record<Filter, number>
  selectedId: string | null
  focusRequest: { id: string; n: number } | null
  onSelect: (id: string) => void
}) {
  const card = useRef<HTMLDivElement | null>(null)
  // Not every browser lets a page go full screen (iPhone Safari doesn't),
  // so the button only appears where it will work. False on the server.
  const canFullscreen = useSyncExternalStore(
    noSubscribe,
    () => Boolean(document.fullscreenEnabled),
    () => false,
  )
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === card.current)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void card.current?.requestFullscreen()
  }

  return (
    <div
      ref={card}
      className={`flex flex-col overflow-hidden border border-line bg-surface ${
        fullscreen ? 'h-dvh' : 'h-full rounded-xl shadow-sm'
      }`}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
          <span aria-hidden className="size-2 rounded-full bg-emerald-500 motion-safe:animate-pulse" />
          Live rider locations
        </h2>
        {canFullscreen ? (
          <button
            type="button"
            onClick={toggle}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2.5 text-xs font-medium text-muted transition-colors hover:bg-sunken hover:text-ink ${focusRing}`}
          >
            {fullscreen ? <IconShrink size={14} aria-hidden /> : <IconExpand size={14} aria-hidden />}
            {fullscreen ? 'Exit full screen' : 'View full screen'}
          </button>
        ) : null}
      </div>

      <div
        // `isolate`: Leaflet's panes carry z-indexes in the hundreds, which
        // would otherwise float the map over the phone's nav drawer (z-50).
        className={`relative isolate border-t border-line ${
          fullscreen
            ? 'min-h-0 flex-1'
            : 'h-80 sm:h-[26rem] @[60rem]/board:h-auto @[60rem]/board:min-h-0 @[60rem]/board:flex-1'
        }`}
      >
        <RiderMap riders={riders} selectedId={selectedId} focusRequest={focusRequest} onSelect={onSelect} />

        {/* The map's key, in the markers' own colours, floated over the map.
            z-index clears Leaflet's panes. */}
        <ul
          aria-label="Map key"
          className="absolute bottom-3 left-3 z-[500] flex max-w-[calc(100%-1.5rem)] flex-wrap gap-x-3.5 gap-y-1 rounded-lg border border-line bg-surface/95 px-3 py-1.5 shadow-sm backdrop-blur"
        >
          {BOARD_STATUS.map((s) => (
            <li key={s} className="inline-flex items-center gap-1.5 text-xs font-medium text-ink tabular-nums">
              <span aria-hidden className={`size-2 rounded-full ${STATUS_TONE[s].dot}`} />
              {BOARD_STATUS_LABEL[s]} ({counts[s]})
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/* ── roster ──────────────────────────────────────────────────────────────── */

function StatusTabs({
  counts,
  active,
  onChange,
}: {
  counts: Record<Filter, number>
  active: Filter
  onChange: (f: Filter) => void
}) {
  const tabs: { key: Filter; label: string; count: string }[] = [
    { key: 'ALL', label: 'All riders', count: 'bg-sunken text-ink' },
    ...BOARD_STATUS.map((s) => ({
      key: s as Filter,
      label: BOARD_STATUS_LABEL[s],
      count: STATUS_TONE[s].badge,
    })),
  ]

  return (
    <div
      role="group"
      aria-label="Filter by status"
      className="-mx-1 flex gap-1.5 overflow-x-auto px-1 py-0.5 [scrollbar-width:none]"
    >
      {tabs.map(({ key, label, count }) => {
        const on = key === active
        return (
          <button
            key={key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(key)}
            className={`inline-flex h-8 shrink-0 items-center gap-2 rounded-full px-3 text-xs font-medium whitespace-nowrap transition-colors ${focusRing} ${
              on ? 'bg-accent-soft text-accent' : 'bg-sunken/60 text-muted hover:bg-sunken hover:text-ink'
            }`}
          >
            {label}
            <span
              className={`min-w-5 rounded-full px-1.5 py-0.5 text-center text-[11px] leading-none font-semibold tabular-nums ${
                on ? 'bg-accent text-white' : count
              }`}
            >
              {counts[key]}
            </span>
          </button>
        )
      })}
    </div>
  )
}

type RosterProps = {
  riders: RiderView[]
  now: Date
  selectedId: string | null
  onShowOnMap: (id: string) => void
}

/** What a rider's last fix says about their movement, as one short line. */
function movementOf(rider: RiderView, now: Date): { text: string; warn: boolean } {
  const pos = rider.position
  if (!pos) return { text: 'No position yet', warn: false }
  if (rider.presence === 'OFFLINE') return { text: `Last seen ${ageLabel(pos.recordedAt, now)}`, warn: false }
  // Worth saying out loud: at this radius the dot is the neighbourhood, not
  // the platform.
  if (pos.accuracyMetres != null && pos.accuracyMetres > 100) {
    return { text: `Approximate · ±${Math.round(pos.accuracyMetres)}m`, warn: true }
  }
  const speed = speedLabel(pos.speedMetresPerSecond)
  const heading = headingLabel(pos.headingDegrees)
  const moving = speed && speed !== 'Stationary' && heading ? `${speed} ${heading}` : speed
  const text = [moving, pos.accuracyMetres ? `±${Math.round(pos.accuracyMetres)}m` : null]
    .filter(Boolean)
    .join(' · ')
  return { text: text || 'Position received', warn: false }
}

function lastActiveOf(rider: RiderView, now: Date): string {
  const at = rider.position?.recordedAt ?? rider.work.lastDeliveredAt
  return at ? ageLabel(at, now) : '—'
}

function Avatar({ rider, size = 'size-9' }: { rider: RiderView; size?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-flex ${size} shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${
        STATUS_TONE[boardStatusOf(rider)].avatar
      }`}
    >
      {initialsOf(rider.name)}
    </span>
  )
}

function StatusBadge({ rider }: { rider: RiderView }) {
  const tone = STATUS_TONE[boardStatusOf(rider)]
  return (
    <span
      title={PRESENCE_NOTE[rider.presence]}
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${tone.badge}`}
    >
      <span aria-hidden className={`size-1.5 rounded-full ${tone.dot}`} />
      {statusLabelOf(rider)}
    </span>
  )
}

function StationChip({ rider }: { rider: RiderView }) {
  const code = rider.work.stations[0]
  if (!code) return <span className="text-faint">—</span>
  const more = rider.work.stations.length - 1
  return (
    <span className="inline-flex items-center gap-1" title={rider.work.stations.join(', ')}>
      <span className="rounded-md bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
        {code}
      </span>
      {more > 0 ? <span className="text-xs text-muted">+{more}</span> : null}
    </span>
  )
}

function PhoneLink({ phone }: { phone: string }) {
  if (!phone) return null
  return (
    <a
      href={`tel:${phone}`}
      className={`inline-flex items-center gap-1 rounded text-xs text-muted tabular-nums hover:text-accent ${focusRing}`}
    >
      <IconPhone size={11} aria-hidden />
      {phone}
    </a>
  )
}

/**
 * Locate, and a menu of the rest. The menu is a native <details>, which the
 * browser already opens, closes and keeps keyboard-reachable; light dismiss
 * is the one thing it lacks, added below.
 */
function RowActions({ rider, onShowOnMap }: { rider: RiderView; onShowOnMap: (id: string) => void }) {
  const placed = rider.position !== null && rider.presence !== 'NEVER'
  const menu = useRef<HTMLDetailsElement | null>(null)

  useEffect(() => {
    const el = menu.current
    if (!el) return
    const close = (e: Event) => {
      if (!el.open) return
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !el.contains(e.target as Node)) {
        el.open = false
      }
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [])

  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={() => onShowOnMap(rider.id)}
        disabled={!placed}
        aria-label={`Show ${rider.name} on map`}
        title={placed ? 'Show on map' : 'Not on the map'}
        className={`inline-flex size-8 items-center justify-center rounded-lg border border-accent/20 bg-accent-soft text-accent transition-colors hover:bg-accent hover:text-white active:scale-[0.97] disabled:cursor-not-allowed disabled:border-line disabled:bg-sunken disabled:text-faint ${focusRing}`}
      >
        <IconLocate size={15} aria-hidden />
      </button>
      <details ref={menu} className="relative">
        <summary
          aria-label={`More actions for ${rider.name}`}
          title="More"
          className={`inline-flex size-8 cursor-pointer list-none items-center justify-center rounded-lg border border-line-strong bg-surface text-muted transition-colors hover:bg-sunken hover:text-ink [&::-webkit-details-marker]:hidden ${focusRing}`}
        >
          <IconMore size={15} aria-hidden />
        </summary>
        <div className="absolute top-full right-0 z-20 mt-1 w-40 origin-top-right rounded-lg border border-line bg-surface p-1 text-sm shadow-md motion-safe:animate-pop">
          <Link
            href={`/admin/setup?tab=staff&edit=${rider.id}`}
            className={`block rounded-md px-2.5 py-1.5 text-ink hover:bg-sunken ${focusRing}`}
          >
            Account
          </Link>
          {rider.phone ? (
            <a
              href={`tel:${rider.phone}`}
              className={`block rounded-md px-2.5 py-1.5 text-ink hover:bg-sunken ${focusRing}`}
            >
              Call {rider.name.split(/\s+/)[0]}
            </a>
          ) : null}
        </div>
      </details>
    </div>
  )
}

const th = 'px-1.5 py-2.5 text-left align-bottom text-xs font-medium leading-tight text-muted'
const td = 'px-1.5 py-3'

function RosterTable({ riders, now, selectedId, onShowOnMap }: RosterProps) {
  return (
    <div className="hidden min-h-0 flex-1 overflow-x-hidden overflow-y-auto border-t border-line @2xl:block">
      {/* Fixed layout, never wider than the card: every column but Rider has
          a set width and Rider takes what is left, truncating a long name
          rather than pushing the row sideways. The row scrolls up, not
          across. */}
      <table className="w-full table-fixed text-sm">
        <colgroup>
          <col />
          <col className="w-[3.75rem]" />
          <col className="w-[7.25rem]" />
          <col className="w-[3.25rem]" />
          <col className="w-[3.25rem]" />
          <col className="w-[4.25rem]" />
          <col className="w-[4.5rem]" />
          <col className="w-[4.25rem]" />
          <col className="w-[4.75rem]" />
        </colgroup>
        <thead className="sticky top-0 z-20 shadow-[0_1px_0_var(--color-line)]">
          <tr className="bg-canvas">
            <th className={`${th} pl-4`}>Rider</th>
            <th className={th}>
              Station
              <br />
              Code
            </th>
            <th className={th}>Status</th>
            <th className={`${th} text-right`}>
              Total
              <br />
              Orders
            </th>
            <th className={`${th} text-right`}>
              COD
              <br />
              Orders
            </th>
            <th className={`${th} text-right`}>
              COD
              <br />
              Amount
            </th>
            <th className={`${th} text-right`}>
              Total
              <br />
              Amount
            </th>
            <th className={th}>
              Last
              <br />
              Active
            </th>
            <th className={`${th} pr-3 text-right`}>Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {riders.map((rider) => {
            const move = movementOf(rider, now)
            const { orders, codOrders, codPaise, amountPaise, carrying } = rider.work
            const selected = rider.id === selectedId
            return (
              <tr
                key={rider.id}
                id={`rider-${rider.id}`}
                className={`scroll-my-2 transition-colors ${selected ? 'bg-accent-soft' : 'hover:bg-canvas'}`}
              >
                <td className={`${td} pl-4`}>
                  <p
                    title={rider.name}
                    className={`truncate font-medium ${selected ? 'text-accent' : 'text-ink'}`}
                  >
                    {rider.name}
                  </p>
                  <PhoneLink phone={rider.phone} />
                </td>
                <td className={td}>
                  <StationChip rider={rider} />
                </td>
                <td className={td}>
                  <StatusBadge rider={rider} />
                  <p
                    title={move.text}
                    className={`mt-1 truncate text-xs ${move.warn ? 'text-amber-800' : 'text-muted'}`}
                  >
                    {move.text}
                  </p>
                </td>
                <td className={`${td} text-right tabular-nums`}>
                  <span className="font-semibold text-ink">{orders}</span>
                  {carrying > 0 ? (
                    <span className="block truncate text-xs text-blue-700">{carrying} in hand</span>
                  ) : null}
                </td>
                <td className={`${td} text-right text-ink tabular-nums`}>{codOrders}</td>
                <td className={`${td} truncate text-right text-ink tabular-nums`}>{formatRupees(codPaise)}</td>
                <td className={`${td} truncate text-right font-semibold text-ink tabular-nums`}>
                  {formatRupees(amountPaise)}
                </td>
                <td className={`${td} truncate text-xs text-muted tabular-nums`}>{lastActiveOf(rider, now)}</td>
                <td className={`${td} pr-3`}>
                  <RowActions rider={rider} onShowOnMap={onShowOnMap} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** The same roster as cards, for a card too narrow to hold the table's columns. */
function RosterCards({ riders, now, selectedId, onShowOnMap }: RosterProps) {
  return (
    <ul aria-label="Riders" className="min-h-0 flex-1 divide-y divide-line overflow-y-auto border-t border-line @2xl:hidden">
      {riders.map((rider) => {
        const move = movementOf(rider, now)
        const { orders, codOrders, codPaise, amountPaise, carrying } = rider.work
        return (
          <li
            key={rider.id}
            id={`rider-${rider.id}`}
            className={`scroll-my-2 px-3 py-3.5 ${rider.id === selectedId ? 'bg-accent-soft/70' : ''}`}
          >
            <div className="flex items-start gap-3">
              <Avatar rider={rider} size="size-10" />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{rider.name}</p>
                    <PhoneLink phone={rider.phone} />
                  </div>
                  <StatusBadge rider={rider} />
                </div>
                <p className={`mt-1 text-xs ${move.warn ? 'text-amber-800' : 'text-muted'}`}>
                  {move.text} · active {lastActiveOf(rider, now)}
                </p>
              </div>
            </div>

            <dl className="mt-3 grid grid-cols-4 gap-2 rounded-lg bg-canvas px-3 py-2 text-center">
              <MiniStat label="Orders" value={String(orders)} />
              <MiniStat label="COD" value={String(codOrders)} />
              <MiniStat label="COD amt" value={formatRupees(codPaise)} />
              <MiniStat label="Total" value={formatRupees(amountPaise)} />
            </dl>

            <div className="mt-2.5 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
                <StationChip rider={rider} />
                {carrying > 0 ? (
                  <span className="truncate text-blue-700">
                    {carrying} in hand{rider.work.trains.length ? ` · ${rider.work.trains.join(', ')}` : ''}
                  </span>
                ) : null}
              </div>
              <RowActions rider={rider} onShowOnMap={onShowOnMap} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="truncate text-sm font-semibold text-ink tabular-nums">{value}</dd>
    </div>
  )
}

/** The same green-dot vocabulary the other live boards use. */
function LiveIndicator({ stale }: { stale: boolean }) {
  return (
    <span
      className={`inline-flex h-9 items-center gap-1.5 px-1 text-sm ${
        stale ? 'text-amber-800' : 'text-muted'
      }`}
      title={`Positions refresh every ${BOARD_REFRESH_SECONDS} seconds`}
    >
      <span
        aria-hidden
        className={`inline-block size-2 rounded-full ${
          stale ? 'bg-amber-500' : 'bg-emerald-500 motion-safe:animate-pulse'
        }`}
      />
      <span className="tabular-nums">
        {stale ? 'Not updating' : `Live tracking · updates every ${BOARD_REFRESH_SECONDS}s`}
      </span>
    </span>
  )
}
