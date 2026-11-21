import { Fragment } from 'react'
import Link from 'next/link'
import { requirePermission } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { Restaurant, User } from '@/lib/models'
import { countOrders } from '@/lib/repo/orderRepo'
import { listPendingCancelRequests } from '@/lib/repo/cancelRequestRepo'
import { LIVE_STATUSES } from '@/lib/repo/runRepo'
import { runTrainLabel } from '@/lib/runs'
import { formatIST, formatServiceDate, shiftServiceDate, todayIST } from '@/lib/format'
import { callBoardRow } from '@/lib/orderView'
import { loadRunBoard, todayBoardFilter, yesterdayBoardFilter, type BoardMode } from '@/lib/board'
import { STATUS_GROUPS, arrivalBucket, isCalled, isFiltered, readCallFilter, rowMatches, type CallState, type StatusGroup } from '@/lib/callBoard'
import { isSimulatedProvider } from '@/lib/train'
import { calledCount, runCounts, sectionise, type CallsRun } from '@/lib/v2/calls'
import { startDateLabelFor, trackingNoteFor } from '@/lib/v2/kitchenView'
import { Card, Chip, Mono, cx, v2Focus } from '@/components/v2/ui'
import { EmptyState, Notice, PageHeader, Pagination, PillTabs, readPaging } from '@/components/v2/Table'
import { CallsRunFold } from '@/components/v2/CallsRunFold'
import { CallsToolbar } from '@/components/v2/CallsToolbar'
import { CallsRow } from '@/components/v2/CallsRow'
import { CallsRefresh, CallsStaleNotice } from '@/components/v2/CallsRefresh'
import { CallsCancellationFeed } from '@/components/v2/CallsCancellationFeed'
import { DayPicker } from '@/components/v2/DayPicker'

export const metadata = { title: 'Call board · RailServe' }

const BOARD_ID = 'calls-board'
type Day = 'today' | 'yesterday' | 'upcoming'

/**
 * The call board: the same trains, in the same order, on the same timing as
 * the kitchen board (loadRunBoard is shared), with a phone number on every
 * passenger so a run can be rung top to bottom. Sectioned by how soon each
 * train arrives; a train folds once everyone on it has been called.
 *
 * No money reaches this page: callBoardRow carries the payment mode and never
 * an amount, whoever is looking.
 */
export default async function V2CallsPage(props: PageProps<'/v2/calls'>) {
  const ctx = await requirePermission('calls.operate')
  const sp = await props.searchParams
  const { page, pageSize, skip } = readPaging(sp)
  const filter = readCallFilter(sp)
  const filtered = isFiltered(filter)
  const groupParam = typeof sp.group === 'string' && sp.group === '0' ? '0' : ''
  const isGrouped = groupParam !== '0'
  const dayParam = typeof sp.day === 'string' ? sp.day : ''
  const day: Day = dayParam === 'yesterday' || dayParam === 'upcoming' ? dayParam : 'today'

  const now = new Date()
  const serverNowMs = now.getTime()
  const today = todayIST(now)
  const yesterday = shiftServiceDate(today, -1)
  // A picked service day (never today) overrides the tabs and shows every status.
  const dateParam = typeof sp.date === 'string' ? sp.date : ''
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam) && dateParam !== today && !Number.isNaN(Date.parse(dateParam)) ? dateParam : null
  const mode: BoardMode = date ? 'date' : day
  const isAdmin = ctx.role === 'ADMIN'

  await connectDb()
  // Cache-only timing: this desk reads the train feed and never spends the
  // provider quota; the train-poll cron keeps the rows warm.
  const [board, todayCount, yesterdayCount, upcomingCount, cancelRequests, adminOutlets] = await Promise.all([
    loadRunBoard(ctx, mode, { allowFetch: false, now, ...(date ? { date } : {}) }),
    countOrders(ctx, todayBoardFilter(now)),
    countOrders(ctx, yesterdayBoardFilter(now)),
    countOrders(ctx, { serviceDate: { $gt: today }, status: { $in: LIVE_STATUSES } }),
    listPendingCancelRequests(ctx),
    // An admin sees every outlet, so the board names them the way a
    // multi-outlet telecaller's does.
    isAdmin ? Restaurant.find({ tenantId: ctx.tenantId }).select('name').sort({ name: 1 }).lean() : Promise.resolve([]),
  ])
  const outletName = isAdmin ? new Map(adminOutlets.map((o) => [String(o._id), o.name])) : board.outletName
  const multiOutlet = isAdmin ? outletName.size > 1 : board.multiOutlet

  // Who wrote the latest note on each order, in one query.
  const lastAuthorIds = board.runs.flatMap((r) => r.orders.flatMap((o) => (o.callLog?.at(-1)?.userId ? [String(o.callLog.at(-1)!.userId)] : [])))
  const authors = lastAuthorIds.length ? await User.find({ _id: { $in: lastAuthorIds }, tenantId: ctx.tenantId }).select('name').lean() : []
  const actorName = new Map(authors.map((a) => [String(a._id), a.name]))

  const outletOk = (restaurantId: unknown) => !filter.outlet || String(restaurantId) === filter.outlet
  const shaped = board.runs.map((run) => ({
    run,
    rows: run.orders
      .filter((o) => outletOk(o.restaurantId))
      .map((o) => callBoardRow(o, { outletName: multiOutlet ? (outletName.get(String(o.restaurantId)) ?? null) : null, actorName })),
  }))

  // Chip counts describe the outlet scope; each chip's count is what pressing it yields.
  const scopeOnly = { ...filter, call: 'all' as const, status: 'all' as const, q: '' }
  const inScope = shaped.flatMap(({ run, rows }) => rows.filter((r) => rowMatches(r, run, scopeOnly)))
  const countCall = (call: CallState) => inScope.filter((r) => rowMatches(r, { trainNo: null, trainName: null }, { ...scopeOnly, call })).length
  const countStatus = (g: Exclude<StatusGroup, 'all'>) => inScope.filter((r) => STATUS_GROUPS[g].includes(r.status)).length
  const counts = {
    call: { all: inScope.length, todo: countCall('todo'), done: inScope.filter(isCalled).length },
    status: { all: inScope.length, new: countStatus('new'), preparing: countStatus('preparing'), ready: countStatus('ready'), platform: countStatus('platform') },
  }

  // Every train that still has a passenger after filtering, serialised, in
  // section order. Sections and their counts cover the whole result; only the
  // runs are paged, whole trains at a time, so a train is never split.
  const visible: CallsRun[] = shaped
    .map(({ run, rows }) => ({ run, rows: rows.filter((r) => rowMatches(r, run, filter)) }))
    .filter(({ rows }) => rows.length > 0)
    .map(({ run, rows }) => {
      const t = board.timingOf(run)
      return {
        key: run.key,
        trainLabel: runTrainLabel(run),
        trainName: run.trainName,
        stationCode: run.stationCode,
        etaIso: t.effectiveArrival?.toISOString() ?? null,
        bookedIso: t.scheduledArrival?.toISOString() ?? null,
        platform: t.platform,
        delayMinutes: t.delayMinutes,
        arrived: t.arrived,
        startDateLabel: startDateLabelFor(t.startDate, run.serviceDate),
        trackingNote: trackingNoteFor(t),
        bucket: arrivalBucket(t.effectiveArrival, board.loadedAt),
        rows,
      }
    })
  const sections = sectionise(visible)
  const ordered = sections.flatMap((s) => s.runs)
  const pageKeys = new Set(ordered.slice(skip, skip + pageSize).map((r) => r.key))
  const flatRows = ordered.flatMap((run) => run.rows.map((row) => ({ run, row })))
  const pageFlat = flatRows.slice(skip, skip + pageSize)
  const total = isGrouped ? ordered.length : flatRows.length
  const shown = flatRows.length

  const outlets = multiOutlet ? [...outletName.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)) : []
  const canCancel = (row: { canCancel: boolean }) => ctx.role === 'TELECALLER' && row.canCancel

  // Links keep every filter and the group mode; only the page resets.
  const params = (over: { day?: Day; date?: string | null; page?: number; pageSize?: number } = {}) => {
    const u = new URLSearchParams()
    const d = over.day ?? day
    const dt = over.date === undefined ? date : over.date
    if (d !== 'today') u.set('day', d)
    if (dt) u.set('date', dt)
    if (filter.q) u.set('q', filter.q)
    if (filter.call !== 'all') u.set('call', filter.call)
    if (filter.status !== 'all') u.set('status', filter.status)
    if (filter.outlet) u.set('outlet', filter.outlet)
    if (groupParam) u.set('group', groupParam)
    const p = over.page ?? 1
    const ps = over.pageSize ?? pageSize
    if (p > 1) u.set('page', String(p))
    if (ps !== 20) u.set('pageSize', String(ps))
    const s = u.toString()
    return s ? `/v2/calls?${s}` : '/v2/calls'
  }
  const carried: [string, string][] = [...(day === 'today' ? [] : [['day', day] as [string, string]]), ...(date ? [['date', date] as [string, string]] : [])]
  const renderedAt = board.loadedAt.toISOString()
  const feed = board.feedHealth

  return (
    <div className="grid gap-[18px]">
      <PageHeader
        title="Call board"
        note={
          date
            ? `${formatServiceDate(date)} · ${inScope.length} order${inScope.length === 1 ? '' : 's'} on ${board.runs.length} train${board.runs.length === 1 ? '' : 's'}${filtered ? ` · showing ${shown}` : ''}`
            : day === 'upcoming'
            ? 'Orders booked for a later date.'
            : day === 'yesterday'
              ? `Yesterday · ${formatServiceDate(yesterday)}`
              : filtered
                ? `${formatServiceDate(today)} · showing ${shown} of ${inScope.length} open orders`
                : `${formatServiceDate(today)} · ${inScope.length} open order${inScope.length === 1 ? '' : 's'} on ${board.runs.length} train${board.runs.length === 1 ? '' : 's'}`
        }
        actions={<CallsRefresh renderedAt={renderedAt} />}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <PillTabs
            tabs={[
              { href: params({ day: 'today', date: null }), label: 'Today', count: todayCount, active: !date && day === 'today' },
              { href: params({ day: 'yesterday', date: null }), label: 'Yesterday', count: yesterdayCount, active: !date && day === 'yesterday' },
              { href: params({ day: 'upcoming', date: null }), label: 'Upcoming', count: upcomingCount, active: !date && day === 'upcoming' },
            ]}
          />
          <DayPicker value={date ?? (day === 'yesterday' ? yesterday : today)} today={today} label="Service day" resetKeys={['page', 'day']} />
        </div>
      </div>

      <CallsStaleNotice renderedAt={renderedAt} />
      {isSimulatedProvider() ? (
        <Notice tone="warn">Train times on this screen are simulated, not live.</Notice>
      ) : feed.failing ? (
        <Notice tone={feed.failingTrains.length >= feed.trainsTried ? 'bad' : 'warn'}>
          {feed.failingTrains.length >= feed.trainsTried
            ? 'Live train feed is down. Times are from the timetable.'
            : `No live status for ${feed.failingTrains.length} of ${feed.trainsTried} trains; their times are from the timetable.`}
          {feed.lastSuccessAt ? ` Last live reading ${formatIST(feed.lastSuccessAt)}.` : ''}
        </Notice>
      ) : null}

      <CallsCancellationFeed />

      {cancelRequests.length > 0 ? (
        <Card title="Cancellation requests waiting" action={<Chip tone="warn">{cancelRequests.length}</Chip>}>
          <ul className="min-w-0 divide-y divide-v2-line">
            {cancelRequests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm first:pt-0 last:pb-0">
                <Link href={`/v2/orders/${r.id}`} className={cx('font-mono font-semibold text-v2-brand underline-offset-2 hover:underline', v2Focus)}>
                  {r.externalOrderId}
                </Link>
                {r.trainNo ? <Mono className="text-v2-muted">{r.trainNo}</Mono> : null}
                {r.rawSeat ? <Mono className="text-v2-muted">{r.rawSeat}</Mono> : null}
                <span className="min-w-0 flex-1 truncate" title={r.reason}>
                  &ldquo;{r.reason}&rdquo;
                </span>
                <span className="text-xs text-v2-muted">
                  {r.requestedBy} · {formatIST(r.requestedAt)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <CallsToolbar filter={filter} outlets={outlets} counts={counts} carried={carried} groupParam={groupParam} boardId={BOARD_ID} />

      {total === 0 ? (
        filtered ? (
          <EmptyState
            title="Nothing matches"
            note="No passenger on the board fits these filters. Try a shorter search, or clear the filters."
            action={
              <Link href={params()} className={cx('text-sm font-semibold text-v2-brand underline-offset-2 hover:underline', v2Focus)}>
                Clear all
              </Link>
            }
          />
        ) : (
          <EmptyState
            title={date ? `Nothing on ${formatServiceDate(date)}` : day === 'upcoming' ? 'Nothing booked ahead' : day === 'yesterday' ? 'Nothing from yesterday' : 'No orders to call'}
            note={
              date
                ? 'No orders were booked for this service day at the outlets you cover.'
                : day === 'upcoming'
                ? 'Bulk orders booked for a later date appear here.'
                : day === 'yesterday'
                  ? 'Orders from the previous service day show here, including any still open after midnight.'
                  : 'Orders appear here as they arrive at the outlets you cover, grouped by the train they are on.'
            }
          />
        )
      ) : isGrouped ? (
        <div id={BOARD_ID} className="grid min-w-0 gap-3">
          {sections.map((section) => {
            const onPage = section.runs.filter((r) => pageKeys.has(r.key))
            if (onPage.length === 0) return null
            return (
              <Fragment key={section.bucket}>
                <div className="flex items-center gap-3 pt-2 first:pt-0">
                  <h2 className="text-sm font-bold">{section.label}</h2>
                  <span className="text-sm tabular-nums text-v2-muted">
                    {section.runs.length} train{section.runs.length === 1 ? '' : 's'} · {section.passengers} passenger{section.passengers === 1 ? '' : 's'}
                  </span>
                  <span aria-hidden className="h-px flex-1 bg-v2-line" />
                </div>
                {onPage.map((run) => {
                  const called = calledCount(run.rows)
                  const done = called === run.rows.length
                  return (
                    // Open while someone is left to ring, or while a search needs to show what matched.
                    <CallsRunFold
                      key={run.key}
                      runKey={run.key}
                      defaultOpen={filtered || !done}
                      header={{
                        trainLabel: run.trainLabel,
                        trainName: run.trainName,
                        stationCode: run.stationCode,
                        startDateLabel: run.startDateLabel,
                        trackingNote: run.trackingNote,
                        etaIso: run.etaIso,
                        bookedIso: run.bookedIso,
                        platform: run.platform,
                        delayMinutes: run.delayMinutes,
                        arrived: run.arrived,
                        serverNowMs,
                        counts: runCounts(run.rows),
                        summary: `${called} of ${run.rows.length} called`,
                      }}
                      chips={done ? <Chip tone="ok">All called</Chip> : <Chip tone="warn">{run.rows.length - called} to call</Chip>}
                    >
                      <div className="overflow-hidden rounded-v2-lg border border-v2-line bg-v2-surface">
                        <ul className="min-w-0 divide-y divide-v2-line">
                          {run.rows.map((row) => (
                            <CallsRow key={row.id} row={row} canCancel={canCancel(row)} />
                          ))}
                        </ul>
                      </div>
                    </CallsRunFold>
                  )
                })}
              </Fragment>
            )
          })}
        </div>
      ) : (
        <div id={BOARD_ID} className="overflow-hidden rounded-v2-lg border border-v2-line bg-v2-surface">
          <ul className="min-w-0 divide-y divide-v2-line">
            {pageFlat.map(({ run, row }) => (
              <CallsRow key={row.id} row={row} train={{ trainLabel: run.trainLabel, trainName: run.trainName }} canCancel={canCancel(row)} />
            ))}
          </ul>
        </div>
      )}

      {total > 0 ? (
        <div className="rounded-v2-lg border border-v2-line bg-v2-surface">
          <Pagination page={page} pageSize={pageSize} total={total} buildHref={(t) => params({ page: t.page, pageSize: t.pageSize })} />
        </div>
      ) : null}
    </div>
  )
}
