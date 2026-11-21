'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Banknote,
  Bike,
  HandCoins,
  LocateFixed,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  PackageCheck,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Users,
  Wallet,
} from 'lucide-react'
import { BOARD_REFRESH_SECONDS, PRESENCE_NOTE, ageLabel, headingLabel, speedLabel } from '@/lib/riderLocation'
import {
  BOARD_STATUS, BOARD_STATUS_LABEL, STATUS_DOT, boardStatusOf, maskPhone, statusWordOf, type BoardStatus } from '@/lib/v2/ridersShared'
import type { OutletChoice, RiderRoster, RosterRider } from '@/lib/v2/riders'
import { formatIST, formatRupees, formatTimeIST } from '@/lib/format'
import { useNowMs } from '@/components/useNow'
import { toggleRiderActiveV2 } from '@/app/v2/riders/actions'
import { Select } from './Select'
import { Avatar, Button, Card, Chip, Mono, cx, v2Focus } from './ui'
import { EmptyState, Notice, Pagination, Sub, Table, Td, Th, readPaging, rowClass } from './Table'
import { RiderDialog, riderInputClass } from './RiderDialog'
import { RiderCashDialog } from './RiderCashDialog'
import { RiderFormDialog } from './RiderFormDialog'

// Leaflet touches `window` on import, so the map is never part of the server render.
const RiderMap = dynamic(() => import('./RiderMap').then((m) => m.RiderMap), {
  ssr: false,
  loading: () => <div aria-busy="true" className="h-full w-full bg-v2-sunken motion-safe:animate-pulse" />,
})

/** Missed polls before the screen admits it is no longer live. */
const STALE_AFTER_CYCLES = 3

type Filter = 'ALL' | BoardStatus
const FILTER_PARAM: Record<Filter, string | null> = { ALL: null, ONLINE: 'online', ON_DELIVERY: 'on-delivery', IDLE: 'idle', OFFLINE: 'offline' }
function readFilter(value: string | null): Filter {
  return (Object.keys(FILTER_PARAM) as Filter[]).find((f) => FILTER_PARAM[f] === value) ?? 'ALL'
}

const CHIP_TONE: Record<BoardStatus, 'ok' | 'out' | 'grey'> = { ONLINE: 'ok', ON_DELIVERY: 'out', IDLE: 'grey', OFFLINE: 'grey' }

/** A roster is short; five rows fit beside the map without a blank tail. */
const ROSTER_PAGE_SIZES = [5, 10, 20] as const

type Dialog = { kind: 'cash' | 'edit' | 'toggle'; rider: RosterRider } | { kind: 'add' } | null

/**
 * The live rider board: five figures for the day, then the map beside the
 * roster. Polls its own JSON every few seconds and swaps the data in under a
 * Leaflet map whose pan and zoom belong to the operator; a router.refresh()
 * would throw that away. One request in flight at a time: a slow server never
 * gets a queue of identical polls behind it.
 *
 * Status, station and search filter in place (the whole roster is already on
 * the client) and are written to the URL with replaceState so a reload or a
 * shared link restores them. The date and the pager navigate for real.
 */
export function RiderBoard({
  initial,
  mayReceive,
  isAdmin,
  outlets,
  teamLeads,
}: {
  initial: RiderRoster
  /** Whether the signed-in person may take cash from riders. */
  mayReceive: boolean
  isAdmin: boolean
  outlets: OutletChoice[]
  teamLeads: { id: string; name: string }[]
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [roster, setRoster] = useState<RiderRoster>(initial)
  const [failing, setFailing] = useState(false)
  const [lastOkAt, setLastOkAt] = useState(() => new Date(initial.fetchedAt).getTime())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // A counter, not just an id: asking for the same rider twice has to move the map again.
  const [focusRequest, setFocusRequest] = useState<{ id: string; n: number } | null>(null)
  // `?add=1`, `?edit=<id>` and `?collect=<id>` open straight into a dialog,
  // so the dashboard, the rider page and the teams page can hand off here.
  const [dialog, setDialog] = useState<Dialog>(() => {
    if (params.get('add') === '1') return { kind: 'add' }
    const edit = initial.riders.find((r) => r.id === params.get('edit'))
    if (edit) return { kind: 'edit', rider: edit }
    const collect = initial.riders.find((r) => r.id === params.get('collect'))
    return collect ? { kind: 'cash', rider: collect } : null
  })
  const [query, setQuery] = useState(() => params.get('q') ?? '')
  const mapPane = useRef<HTMLDivElement | null>(null)
  const inFlight = useRef(false)

  const { serviceDate, isToday } = roster
  const { page, pageSize } = readPaging(Object.fromEntries(params), ROSTER_PAGE_SIZES)
  const filter = readFilter(params.get('status'))
  const station = params.get('station') ?? ''

  // One second-hand for the age labels, so a board that stops updating
  // visibly ages instead of sitting on a plausible "8s ago".
  const nowMs = useNowMs(1_000)
  const now = nowMs === null ? new Date(roster.fetchedAt) : new Date(nowMs)

  const poll = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      // Today is asked for by omission, so a tab left open across 3am follows the day over.
      const res = await fetch(isToday ? '/v2/riders/api' : `/v2/riders/api?date=${serviceDate}`, { cache: 'no-store' })
      if (!res.ok) {
        setFailing(true)
        return
      }
      setRoster((await res.json()) as RiderRoster)
      setLastOkAt(Date.now())
      setFailing(false)
    } catch {
      setFailing(true)
    } finally {
      inFlight.current = false
    }
  }, [isToday, serviceDate])

  useEffect(() => {
    const timer = setInterval(() => void poll(), BOARD_REFRESH_SECONDS * 1000)
    // Hidden tabs throttle timers; catch up the moment the board is looked at again.
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
      for (const [k, v] of Object.entries(changes)) {
        if (v) next.set(k, v)
        else next.delete(k)
      }
      next.delete('page')
      const qs = next.toString()
      window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname)
    },
    [params],
  )

  const showOnMap = useCallback((id: string) => {
    setSelectedId(id)
    setFocusRequest((prev) => ({ id, n: (prev?.n ?? 0) + 1 }))
    const pane = mapPane.current
    if (!pane) return
    const box = pane.getBoundingClientRect()
    if (box.top < 0 || box.top > window.innerHeight * 0.5) {
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      pane.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' })
    }
  }, [])

  const selectFromMap = useCallback((id: string) => {
    setSelectedId(id)
    document.getElementById(`rider-${id}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [])

  /** After a mutation: refetch now, and let the server tree catch up too. */
  const changed = useCallback(() => {
    void poll()
    router.refresh()
  }, [poll, router])

  /** Close whichever dialog is open, and drop the `?add` / `?edit` / `?collect` that opened it so a reload does not reopen it. */
  const closeDialog = useCallback(() => {
    setDialog(null)
    const next = new URLSearchParams(window.location.search)
    if (!next.has('add') && !next.has('edit') && !next.has('collect')) return
    next.delete('add')
    next.delete('edit')
    next.delete('collect')
    const qs = next.toString()
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname)
  }, [])

  const detailHref = (id: string) => (isToday ? `/v2/riders/${id}` : `/v2/riders/${id}?mode=range&from=${serviceDate}&to=${serviceDate}`)

  const staleMs = nowMs === null ? 0 : nowMs - lastOkAt
  const stale = staleMs > BOARD_REFRESH_SECONDS * STALE_AFTER_CYCLES * 1000

  const riders = roster.riders
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { ALL: riders.length, ONLINE: 0, ON_DELIVERY: 0, IDLE: 0, OFFLINE: 0 }
    for (const r of riders) c[boardStatusOf(r)] += 1
    return c
  }, [riders])
  const stations = useMemo(() => [...new Set(riders.flatMap((r) => r.work.stations))].sort(), [riders])

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
  const pageRiders = visible.slice((page - 1) * pageSize, page * pageSize)
  const filtered = filter !== 'ALL' || station !== '' || query.trim() !== ''

  const pageHref = (t: { page: number; pageSize: number }) => {
    const next = new URLSearchParams(params)
    next.delete('page')
    next.delete('pageSize')
    if (t.page > 1) next.set('page', String(t.page))
    if (t.pageSize !== ROSTER_PAGE_SIZES[0]) next.set('pageSize', String(t.pageSize))
    const qs = next.toString()
    return qs ? `/v2/riders?${qs}` : '/v2/riders'
  }

  const t = roster.totals
  const online = counts.ONLINE + counts.ON_DELIVERY
  const c = roster.carried
  const carriedParts = [
    c.openOrders ? `${c.openOrders} order${c.openOrders === 1 ? '' : 's'} still out from earlier days` : null,
    c.staleOrders ? `${c.staleOrders} older handed over and never closed` : null,
    c.cashOrders ? `${formatRupees(c.cashPaise)} COD from earlier days not yet received (${c.cashOrders} order${c.cashOrders === 1 ? '' : 's'})` : null,
  ].filter(Boolean)

  return (
    <div className="grid gap-[18px]">
      {stale ? (
        <Notice tone="warn">
          This board last reached the server <Mono>{Math.round(staleMs / 1000)}s</Mono> ago; every position below is at least that old.{' '}
          {failing ? 'It keeps retrying. Check your connection.' : 'Catching up.'}
        </Notice>
      ) : null}

      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 xl:grid-cols-5">
        <Stat icon={<Users size={18} strokeWidth={1.8} aria-hidden />} label={isToday ? 'Riders online' : 'Riders'} value={String(isToday ? online : counts.ALL)} note={isToday ? `${counts.ON_DELIVERY} delivering · ${counts.ALL} on the roster` : `${riders.filter((r) => r.work.done > 0).length} worked this day`} />
        <Stat icon={<PackageCheck size={18} strokeWidth={1.8} aria-hidden />} label="Finished" value={String(t.done)} note="delivered, not delivered or cancelled" />
        <Stat icon={<Bike size={18} strokeWidth={1.8} aria-hidden />} label="Delivered" value={String(t.delivered)} note={`${t.notDelivered} not delivered · ${t.cancelled} cancelled`} />
        <Stat icon={<Banknote size={18} strokeWidth={1.8} aria-hidden />} label="COD collected" value={formatRupees(t.codPaise)} note={`from ${t.codOrders} order${t.codOrders === 1 ? '' : 's'}`} />
        <Stat icon={<Wallet size={18} strokeWidth={1.8} aria-hidden />} label="COD to receive" value={formatRupees(t.duePaise)} note={`${t.dueOrders} order${t.dueOrders === 1 ? '' : 's'} from this day`} warm={t.duePaise > 0} />
      </div>
      {carriedParts.length ? (
        <p className="-mt-2 text-[12.5px] text-v2-muted">
          <span className="font-semibold text-v2-ink-2">Carried over:</span> {carriedParts.join(' · ')}.{' '}
          <Link href="/v2/orders?view=all&status=DISPATCHED" className="font-semibold text-v2-brand underline-offset-2 hover:underline">
            See open orders
          </Link>
        </p>
      ) : null}

      {riders.length === 0 ? (
        <EmptyState
          title="No riders yet"
          note="Riders appear here once a delivery agent account exists. Add one and the map fills in as soon as they sign in to the rider app and allow location."
          action={
            <Button variant="primary" onClick={() => setDialog({ kind: 'add' })}>
              <Plus size={16} strokeWidth={2.2} aria-hidden />
              Add rider
            </Button>
          }
        />
      ) : (
        // One fixed height for map and roster on a desktop: the roster scrolls inside its card, so a long list never makes the two blocks uneven.
        <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-[minmax(0,4.5fr)_minmax(0,7.5fr)]">
          <div ref={mapPane} className="min-h-0 min-w-0 scroll-mt-4 xl:h-full">
            <MapCard riders={riders} counts={counts} selectedId={selectedId} focusRequest={focusRequest} onSelect={selectFromMap} />
          </div>

          <Card
            title={
              <>
                Roster <span className="ml-1 font-mono text-sm font-semibold text-v2-muted">{visible.length}</span>
              </>
            }
            action={
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void poll()}
                  aria-label="Refresh now"
                  title={`Refreshes every ${BOARD_REFRESH_SECONDS}s`}
                  className={cx('grid h-8 w-8 place-items-center rounded-full border border-v2-line text-v2-muted hover:bg-v2-surface-2', v2Focus)}
                >
                  <RefreshCw size={14} strokeWidth={2} aria-hidden />
                </button>
                <Button variant="primary" size="sm" onClick={() => setDialog({ kind: 'add' })}>
                  <Plus size={14} strokeWidth={2.4} aria-hidden />
                  Add rider
                </Button>
              </div>
            }
            className="min-h-0 min-w-0 xl:grid-rows-[auto_auto_auto_minmax(0,1fr)_auto]"
          >
            <div role="group" aria-label="Filter by status" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 py-0.5 [scrollbar-width:none]">
              {(['ALL', ...BOARD_STATUS] as Filter[]).map((f) => {
                const on = f === filter
                return (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setParams({ status: FILTER_PARAM[f] })}
                    className={cx(
                      'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors',
                      on ? 'border-v2-brand bg-v2-brand text-white' : 'border-v2-line bg-v2-surface text-v2-ink-2 hover:bg-v2-surface-2',
                      v2Focus,
                    )}
                  >
                    {f === 'ALL' ? 'All' : BOARD_STATUS_LABEL[f]}
                    <span className={cx('rounded-md px-1.5 font-mono text-[11px] tabular-nums', on ? 'bg-white/20 text-white' : 'bg-v2-surface-2 text-v2-muted')}>{counts[f]}</span>
                  </button>
                )
              })}
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <label className="relative min-w-0">
                <span className="sr-only">Search riders</span>
                <Search size={16} strokeWidth={1.8} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-v2-faint" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setParams({ q: e.target.value.trim() || null })
                  }}
                  placeholder="Name, phone or station"
                  autoComplete="off"
                  className={cx(riderInputClass, 'rounded-full pl-9')}
                />
              </label>
              <Select
                aria-label="Station"
                value={station}
                onChange={(v) => setParams({ station: v || null })}
                className="w-auto"
                buttonClassName="border-v2-line-strong"
                options={[{ value: '', label: 'All stations' }, ...stations.map((s) => ({ value: s, label: s }))]}
              />
            </div>

            {visible.length === 0 ? (
              <EmptyState
                title="No riders match"
                note={`Nobody on ${isToday ? 'today’s' : 'this day’s'} roster fits these filters.`}
                action={
                  filtered ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        setQuery('')
                        setParams({ status: null, station: null, q: null })
                      }}
                    >
                      Clear filters
                    </Button>
                  ) : null
                }
              />
            ) : (
              <div className="-mx-[18px] min-h-0 overflow-auto border-t border-v2-line [overscroll-behavior:contain] [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10">
                <Table className="min-w-[56rem]">
                  <thead>
                    <tr>
                      <Th className="pl-[18px] first:rounded-none">Rider</Th>
                      <Th>Status</Th>
                      <Th>Carrying</Th>
                      <Th align="right">Finished</Th>
                      <Th align="right">COD collected</Th>
                      <Th align="right">Cash in hand</Th>
                      <Th>Last delivered</Th>
                      <Th align="right" className="pr-[18px] last:rounded-none">
                        <span className="sr-only">Actions</span>
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRiders.map((r) => (
                      <RosterRow
                        key={r.id}
                        rider={r}
                        now={now}
                        isToday={isToday}
                        selected={r.id === selectedId}
                        mayReceive={mayReceive}
                        href={detailHref(r.id)}
                        onShowOnMap={showOnMap}
                        onSelect={setSelectedId}
                        onCollect={(rider) => setDialog({ kind: 'cash', rider })}
                        onEdit={(rider) => setDialog({ kind: 'edit', rider })}
                        onToggle={(rider) => setDialog({ kind: 'toggle', rider })}
                      />
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
            <Pagination page={page} pageSize={pageSize} total={visible.length} buildHref={pageHref} sizes={ROSTER_PAGE_SIZES} className="-mx-[18px] -mb-[18px] border-t border-v2-line" />
          </Card>
        </div>
      )}

      {dialog?.kind === 'cash' ? (
        <RiderCashDialog rider={dialog.rider} orders={dialog.rider.dueOrders} onClose={closeDialog} onSettled={changed} />
      ) : null}
      {dialog?.kind === 'add' || dialog?.kind === 'edit' ? (
        <RiderFormDialog
          key={dialog.kind === 'edit' ? dialog.rider.id : 'new'}
          values={
            dialog.kind === 'edit'
              ? {
                  id: dialog.rider.id,
                  name: dialog.rider.name,
                  phone: dialog.rider.phone,
                  outletIds: dialog.rider.outletIds,
                  isTeamLead: dialog.rider.isTeamLead,
                  teamLeadId: dialog.rider.teamLeadId,
                  canReceiveCash: dialog.rider.canReceiveCash,
                }
              : undefined
          }
          outlets={outlets}
          teamLeads={teamLeads}
          isAdmin={isAdmin}
          onClose={closeDialog}
          onSaved={() => {
            closeDialog()
            changed()
          }}
        />
      ) : null}
      {dialog?.kind === 'toggle' ? (
        <ToggleActiveDialog
          rider={dialog.rider}
          onClose={closeDialog}
          onDone={() => {
            closeDialog()
            changed()
          }}
        />
      ) : null}
    </div>
  )
}

/* ── figures ─────────────────────────────────────────────────────────────── */

function Stat({ icon, label, value, note, warm }: { icon: ReactNode; label: string; value: string; note: string; warm?: boolean }) {
  return (
    <div className="grid gap-2.5 rounded-v2-lg border border-v2-line bg-v2-surface p-[18px] first:col-span-2 sm:first:col-span-1">
      <span className="flex items-center justify-between text-[13px] font-semibold text-v2-ink-2">
        {label}
        <span className="grid h-[30px] w-[30px] place-items-center rounded-full border border-v2-line-strong text-v2-muted">{icon}</span>
      </span>
      <span className={cx('truncate text-[34px] font-bold leading-none tracking-[-0.04em] tabular-nums', warm && 'text-v2-cod')}>{value}</span>
      <span className="text-[12.5px] text-v2-muted">{note}</span>
    </div>
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
  riders: RosterRider[]
  counts: Record<Filter, number>
  selectedId: string | null
  focusRequest: { id: string; n: number } | null
  onSelect: (id: string) => void
}) {
  const card = useRef<HTMLElement | null>(null)
  // Not every browser lets a page go full screen (iPhone Safari does not).
  const canFullscreen = useSyncExternalStore(noSubscribe, () => Boolean(document.fullscreenEnabled), () => false)
  const [fullscreen, setFullscreen] = useState(false)
  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === card.current)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])
  const placed = riders.filter((r) => r.position && r.presence !== 'NEVER').length

  return (
    <section
      ref={card}
      className={cx('flex min-w-0 flex-col overflow-hidden bg-v2-surface', fullscreen ? 'h-dvh' : 'h-full rounded-v2-lg border border-v2-line')}
    >
      <header className="flex items-center justify-between gap-3 px-[18px] py-3.5">
        <h3 className="inline-flex items-center gap-2 text-[17px] font-bold tracking-[-0.01em]">
          <span aria-hidden className="h-2 w-2 rounded-full bg-v2-brand shadow-[0_0_0_3px_var(--color-v2-brand-soft)] motion-safe:animate-pulse" />
          Live map
          <span className="font-mono text-sm font-semibold text-v2-muted">{placed}</span>
        </h3>
        {canFullscreen ? (
          <Button size="sm" variant="ghost" onClick={() => (document.fullscreenElement ? void document.exitFullscreen() : void card.current?.requestFullscreen())}>
            {fullscreen ? <Minimize2 size={14} aria-hidden /> : <Maximize2 size={14} aria-hidden />}
            {fullscreen ? 'Exit' : 'Full screen'}
          </Button>
        ) : null}
      </header>
      {/* `isolate`: Leaflet's panes carry z-indexes in the hundreds. */}
      <div className={cx('relative isolate border-t border-v2-line', fullscreen ? 'min-h-0 flex-1' : 'h-[380px] xl:h-auto xl:min-h-[360px] xl:flex-1')}>
        <RiderMap riders={riders} selectedId={selectedId} focusRequest={focusRequest} onSelect={onSelect} />
        <ul aria-label="Map key" className="absolute bottom-3 left-3 z-[500] flex max-w-[calc(100%-1.5rem)] flex-wrap gap-x-3.5 gap-y-1 rounded-full border border-v2-line bg-v2-surface/95 px-3.5 py-1.5 backdrop-blur">
          {BOARD_STATUS.map((s) => (
            <li key={s} className="inline-flex items-center gap-1.5 text-xs font-semibold tabular-nums">
              <span aria-hidden className={cx('h-2 w-2 rounded-full', STATUS_DOT[s])} />
              {BOARD_STATUS_LABEL[s]} <span className="font-mono text-v2-muted">{counts[s]}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/* ── roster rows ─────────────────────────────────────────────────────────── */

/** What a rider's last fix says about their movement, as one short line. */
function movementOf(rider: RosterRider, now: Date): string {
  const pos = rider.position
  if (!rider.active) return 'Account switched off'
  if (!pos) return 'No position yet'
  if (rider.presence === 'OFFLINE') return `Last seen ${ageLabel(pos.recordedAt, now)}`
  if (pos.accuracyMetres != null && pos.accuracyMetres > 100) return `Approximate · ±${Math.round(pos.accuracyMetres)}m`
  const speed = speedLabel(pos.speedMetresPerSecond)
  const heading = headingLabel(pos.headingDegrees)
  const moving = speed && speed !== 'Stationary' && heading ? `${speed} ${heading}` : speed
  return [moving, ageLabel(pos.recordedAt, now)].filter(Boolean).join(' · ') || 'Position received'
}

function RosterRow({
  rider,
  now,
  isToday,
  selected,
  mayReceive,
  href,
  onShowOnMap,
  onSelect,
  onCollect,
  onEdit,
  onToggle,
}: {
  rider: RosterRider
  now: Date
  isToday: boolean
  selected: boolean
  mayReceive: boolean
  href: string
  onShowOnMap: (id: string) => void
  onSelect: (id: string) => void
  onCollect: (r: RosterRider) => void
  onEdit: (r: RosterRider) => void
  onToggle: (r: RosterRider) => void
}) {
  const w = rider.work
  const status = boardStatusOf(rider)
  const placed = rider.position !== null && rider.presence !== 'NEVER'
  const due = rider.dueOrders.reduce((a, o) => a + o.paise, 0)
  const menu = useRef<HTMLDetailsElement | null>(null)

  // Native <details> for the menu; light dismiss is the one thing it lacks.
  useEffect(() => {
    const el = menu.current
    if (!el) return
    const close = (e: Event) => {
      if (!el.open) return
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !el.contains(e.target as Node)) el.open = false
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [])

  return (
    <tr
      id={`rider-${rider.id}`}
      className={cx(rowClass(selected, true), 'scroll-my-2', !rider.active && 'text-v2-muted')}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a, button, summary, details, input, select')) return
        if (placed) onShowOnMap(rider.id)
        else onSelect(rider.id)
      }}
    >
      <Td className="pl-[18px]">
        <span className="flex items-center gap-3">
          <Avatar name={rider.name} size={36} className={cx(!rider.active && 'opacity-50 grayscale')} />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <Link href={href} className={cx('truncate font-bold text-v2-ink underline-offset-2 hover:underline', v2Focus)}>
                {rider.name}
              </Link>
              {rider.isTeamLead ? <Chip tone="info">Lead</Chip> : null}
            </span>
            <a href={`tel:${rider.phone}`} className={cx('font-mono text-xs tabular-nums text-v2-muted hover:text-v2-brand', v2Focus)}>
              {maskPhone(rider.phone)}
            </a>
          </span>
        </span>
      </Td>
      <Td>
        <Chip tone={rider.active ? CHIP_TONE[status] : 'grey'} className={cx(!rider.active && 'opacity-70')}>
          <span title={PRESENCE_NOTE[rider.presence]}>{statusWordOf(rider)}</span>
        </Chip>
        <Sub className="mt-1 max-w-[16rem] truncate">{movementOf(rider, now)}</Sub>
      </Td>
      <Td>
        {!isToday ? (
          <span className="text-v2-faint">—</span>
        ) : w.carrying > 0 ? (
          <>
            <b className="font-bold">
              {w.carrying} bag{w.carrying === 1 ? '' : 's'}
            </b>
            {w.trains.length ? (
              <Sub>
                on <Mono>{w.trains.join(', ')}</Mono>
              </Sub>
            ) : null}
          </>
        ) : (
          <span className="text-v2-faint">Nothing</span>
        )}
        {isToday && w.stale > 0 ? (
          <Sub>
            <span title="Marked out over a day and a half ago and never closed">+{w.stale} old, never closed</span>
          </Sub>
        ) : null}
      </Td>
      <Td align="right">
        <Mono className="font-semibold">{w.done}</Mono>
        <Sub>
          {w.delivered} delivered{w.failed > 0 ? ` · ${w.failed} not` : ''}
        </Sub>
      </Td>
      <Td align="right">
        <Mono>{formatRupees(w.codPaise)}</Mono>
        <Sub>
          {w.codOrders} order{w.codOrders === 1 ? '' : 's'}
        </Sub>
      </Td>
      <Td align="right">
        <Mono className={cx('font-semibold', due > 0 && 'text-v2-cod')}>{formatRupees(due)}</Mono>
        {w.earlierDuePaise > 0 ? <Sub>incl. {formatRupees(w.earlierDuePaise)} earlier</Sub> : null}
        {rider.lastHandover ? (
          <Sub>
            Last handed in {formatIST(rider.lastHandover.at)}
            {rider.lastHandover.receivedBy ? ` to ${rider.lastHandover.receivedBy.split(/\s+/)[0]}` : ''}
          </Sub>
        ) : null}
      </Td>
      <Td>
        <Mono>{w.lastDeliveredAt ? formatTimeIST(w.lastDeliveredAt) : '—'}</Mono>
      </Td>
      <Td align="right" className="pr-[18px]">
        <span className="inline-flex items-center justify-end gap-1">
          {mayReceive && due > 0 ? (
            <Button size="sm" variant="soft" onClick={() => onCollect(rider)} aria-label={`Collect ${formatRupees(due)} from ${rider.name}`}>
              <HandCoins size={14} strokeWidth={2} aria-hidden />
              Collect
            </Button>
          ) : null}
          <button
            type="button"
            onClick={() => onShowOnMap(rider.id)}
            disabled={!placed}
            aria-label={`Show ${rider.name} on map`}
            title={placed ? 'Show on map' : 'Not on the map'}
            className={cx('grid h-8 w-8 place-items-center rounded-full border border-v2-line text-v2-ink-2 hover:bg-v2-brand-soft hover:text-v2-brand disabled:opacity-40', v2Focus)}
          >
            <LocateFixed size={15} strokeWidth={2} aria-hidden />
          </button>
          <a
            href={`tel:${rider.phone}`}
            aria-label={`Call ${rider.name}`}
            title="Call"
            className={cx('grid h-8 w-8 place-items-center rounded-full border border-v2-line text-v2-ink-2 hover:bg-v2-surface-2', v2Focus)}
          >
            <Phone size={15} strokeWidth={2} aria-hidden />
          </a>
          <details ref={menu} className="relative">
            <summary
              aria-label={`More actions for ${rider.name}`}
              className={cx('grid h-8 w-8 cursor-pointer list-none place-items-center rounded-full border border-v2-line text-v2-ink-2 hover:bg-v2-surface-2 [&::-webkit-details-marker]:hidden', v2Focus)}
            >
              <MoreHorizontal size={15} strokeWidth={2} aria-hidden />
            </summary>
            <div className="absolute right-0 top-full z-20 mt-1 grid w-44 gap-0.5 rounded-v2-md border border-v2-line bg-v2-surface p-1 text-left text-sm shadow-v2-pop">
              <Link href={href} className={cx('rounded-v2-sm px-2.5 py-1.5 hover:bg-v2-surface-2', v2Focus)}>
                Orders and log
              </Link>
              <button type="button" onClick={() => onEdit(rider)} className={cx('rounded-v2-sm px-2.5 py-1.5 text-left hover:bg-v2-surface-2', v2Focus)}>
                Edit rider
              </button>
              <button
                type="button"
                onClick={() => onToggle(rider)}
                className={cx('rounded-v2-sm px-2.5 py-1.5 text-left hover:bg-v2-surface-2', rider.active ? 'text-v2-bad' : 'text-v2-brand', v2Focus)}
              >
                {rider.active ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          </details>
        </span>
      </Td>
    </tr>
  )
}

/** Switching a rider off blocks their login; it is confirmed, never one tap. */
function ToggleActiveDialog({ rider, onClose, onDone }: { rider: RosterRider; onClose: () => void; onDone: () => void }) {
  const [pending, setPending] = useState(false)
  const deactivating = rider.active
  return (
    <RiderDialog
      title={deactivating ? `Deactivate ${rider.name}?` : `Activate ${rider.name}?`}
      titleId="rider-toggle-dialog"
      role="alertdialog"
      onClose={onClose}
      width="max-w-sm"
      footer={
        <form
          action={async (fd) => {
            setPending(true)
            await toggleRiderActiveV2(fd)
            onDone()
          }}
          className="flex gap-2"
        >
          <input type="hidden" name="id" value={rider.id} />
          <input type="hidden" name="active" value={String(!rider.active)} />
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant={deactivating ? 'danger' : 'primary'} disabled={pending}>
            {pending ? 'Saving…' : deactivating ? 'Deactivate' : 'Activate'}
          </Button>
        </form>
      }
    >
      <p className="text-sm text-v2-muted">
        {deactivating
          ? 'They will not be able to sign in to the rider app and will drop off the live roster. Their orders and cash record stay as they are; nothing is deleted.'
          : 'They will be able to sign in to the rider app again and take orders at their outlets.'}
      </p>
    </RiderDialog>
  )
}
