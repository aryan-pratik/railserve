import { Fragment } from 'react'
import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { User } from '@/lib/models'
import { countOrders } from '@/lib/repo/orderRepo'
import { LIVE_STATUSES } from '@/lib/repo/runRepo'
import { formatServiceDate, shiftServiceDate, todayIST } from '@/lib/format'
import { callBoardRow } from '@/lib/orderView'
import { countLive, loadRunBoard, type BoardMode } from '@/lib/board'
import { inRollover } from '@/lib/liveDay'
import {
  BUCKET_LABEL,
  STATUS_GROUPS,
  arrivalBucket,
  isCalled,
  isFiltered,
  readCallFilter,
  rowMatches,
  type CallState,
  type StatusGroup,
} from '@/lib/callBoard'
import { isSimulatedProvider } from '@/lib/train'
import { AutoRefresh, StaleNotice } from '@/components/AutoRefresh'
import { TrainFeedNotice } from '@/components/TrainFeedNotice'
import { TrainRunFrame } from '@/components/TrainRunCard'
import { GroupByTrainToggle } from '@/components/GroupByTrainToggle'
import { ButtonLink, Card, EmptyState, PageHeader, Pagination, Tabs, statusLabel } from '@/components/ui'
import { readPage, withPage } from '@/lib/pagination'
import { CallBoardRow } from '../CallBoardRow'
import { LiveToolbar } from './LiveToolbar'

export const metadata = { title: 'Live board · RailServe' }

const BOARD_ID = 'live-board'

/**
 * The telecaller's live board.
 *
 * The same trains, in the same order, on the same timing as the kitchen board
 * (loadRunBoard is shared), because "who do I ring first" is answered by which
 * train reaches its platform first. Each train's passengers sit under it with a
 * phone number, so a run can be worked top to bottom.
 *
 * Today / Yesterday / Upcoming are the same service-day split the kitchen
 * board offers, on the same loadRunBoard modes, so switching date here means
 * the same thing it means there. Trains are further sectioned by how soon
 * they arrive, and each folds away: a train whose passengers have all been
 * rung starts folded, because there is nothing left to do on it.
 *
 * A separate page from the call list, not a tab of it. The list answers
 * "find this passenger" and is newest-first; this answers "who is next".
 *
 * No money is passed to this page: callBoardRow carries the payment mode and
 * never an amount, and the repository guards (`latestBalance`,
 * `setPaymentRemark`) still refuse a telecaller regardless of what is rendered.
 */
export default async function LiveBoardPage(props: PageProps<'/calls/live'>) {
  const ctx = await requireRole('TELECALLER')
  const sp = await props.searchParams
  const { page, pageSize, skip } = readPage(sp)
  const filter = readCallFilter(sp)
  const filtered = isFiltered(filter)
  const groupParam = typeof sp.group === 'string' ? sp.group : ''
  const isGrouped = groupParam !== '0'

  const today = todayIST()
  // The service day before today, in IST. Past midnight, last night's orders
  // that are still open leave the Today tab; this is where they can be found.
  const yesterday = shiftServiceDate(today, -1)
  const showYesterday = sp.yesterday === '1'
  const showUpcoming = !showYesterday && sp.upcoming === '1'
  const mode: BoardMode = showUpcoming ? 'upcoming' : showYesterday ? 'yesterday' : 'today'

  // Cache-only timing: this desk reads the train feed, it never spends the
  // provider quota. The train-poll cron keeps the same rows warm for the
  // kitchen board.
  const [board, todayCount, yesterdayCount, upcomingCount] = await Promise.all([
    loadRunBoard(ctx, mode, { allowFetch: false }),
    countLive(ctx),
    // Hidden while last night's open orders are still inside Today (the
    // past-midnight window): counting them here too would double them across
    // two tabs. Every order from yesterday once it's shown, open or finished,
    // matching what the Yesterday view itself lists.
    inRollover() ? Promise.resolve(undefined) : countOrders(ctx, { serviceDate: yesterday }),
    countOrders(ctx, { serviceDate: { $gt: today }, status: { $in: LIVE_STATUSES } }),
  ])

  // Who wrote the latest note on each order, in one query. A board is tens of
  // orders, so every run's authors are fetched up front and the filters can
  // be applied to finished rows.
  const lastAuthorIds = board.runs.flatMap((r) =>
    r.orders.flatMap((o) => {
      const id = o.callLog?.at(-1)?.userId
      return id ? [id] : []
    }),
  )
  let actorName = new Map<string, string>()
  if (lastAuthorIds.length > 0) {
    await connectDb()
    const authors = await User.find({ _id: { $in: lastAuthorIds } }).select('name').lean()
    actorName = new Map(authors.map((a) => [String(a._id), a.name]))
  }

  const outletFilterOk = (restaurantId: unknown) => !filter.outlet || String(restaurantId) === filter.outlet

  // Every passenger, projected once. The outlet narrows what the chip counts
  // describe; the chips then narrow it further, so a chip's count is what you
  // would get by pressing it.
  const shaped = board.runs.map((run) => ({
    run,
    rows: run.orders
      .filter((o) => outletFilterOk(o.restaurantId))
      .map((o) =>
        callBoardRow(o, {
          outletName: board.multiOutlet ? (board.outletName.get(String(o.restaurantId)) ?? null) : null,
          actorName,
        }),
      ),
  }))

  const scopeOnly = { ...filter, call: 'all' as const, status: 'all' as const, q: '' }
  const inScope = shaped.flatMap(({ run, rows }) => rows.filter((r) => rowMatches(r, run, scopeOnly)))
  const countCall = (state: CallState) =>
    inScope.filter((r) => rowMatches(r, { trainNo: null, trainName: null }, { ...scopeOnly, call: state })).length
  const countStatus = (group: StatusGroup) =>
    group === 'all' ? inScope.length : inScope.filter((r) => STATUS_GROUPS[group].includes(r.status)).length
  const counts = {
    call: { all: inScope.length, todo: countCall('todo'), done: inScope.filter(isCalled).length },
    status: {
      all: inScope.length,
      new: countStatus('new'),
      preparing: countStatus('preparing'),
      ready: countStatus('ready'),
      platform: countStatus('platform'),
    },
  }

  // What is actually shown: trains that still have a passenger after filtering.
  const visible = shaped
    .map(({ run, rows }) => ({ run, rows: rows.filter((r) => rowMatches(r, run, filter)) }))
    .filter(({ rows }) => rows.length > 0)

  // A page is a page of whole trains, like the kitchen board: a run split
  // across pages would hide half of the passengers on a train being worked.
  const pageRuns = visible.slice(skip, skip + pageSize)
  const shownOrders = visible.reduce((n, v) => n + v.rows.length, 0)
  const renderedAt = board.loadedAt.toISOString()

  // Same rows, un-grouped: each still carries which train it's on, since
  // there is no train header above it here to say so — see the toggle.
  const flatRows = visible.flatMap(({ run, rows }) =>
    rows.map((row) => ({ ...row, trainNo: run.trainNo, trainName: run.trainName })),
  )
  const pageFlatRows = flatRows.slice(skip, skip + pageSize)
  const total = isGrouped ? visible.length : flatRows.length

  const outlets = board.multiOutlet
    ? [...board.outletName.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
    : []

  // Switching the date tab or the group toggle carries the search/call/
  // status/outlet filters along, and always starts back at page one — the
  // set of rows being paged has changed either way.
  const dateParams = (over: { yesterday?: boolean; upcoming?: boolean; group?: string } = {}) => {
    const u = new URLSearchParams()
    if (filter.q) u.set('q', filter.q)
    if (filter.call !== 'all') u.set('call', filter.call)
    if (filter.status !== 'all') u.set('status', filter.status)
    if (filter.outlet) u.set('outlet', filter.outlet)
    if (over.yesterday ?? showYesterday) u.set('yesterday', '1')
    if (!over.yesterday && (over.upcoming ?? showUpcoming)) u.set('upcoming', '1')
    const group = over.group ?? groupParam
    if (group) u.set('group', group)
    return u
  }
  const dateHref = (over: { yesterday?: boolean; upcoming?: boolean }) => {
    const s = withPage(dateParams(over), { page: 1, pageSize }).toString()
    return s ? `/calls/live?${s}` : '/calls/live'
  }
  const groupHref = (group: string) => {
    const s = withPage(dateParams({ group }), { page: 1, pageSize }).toString()
    return s ? `/calls/live?${s}` : '/calls/live'
  }
  const pageHref = (target: { page: number; pageSize: number }) => {
    const s = withPage(dateParams(), target).toString()
    return s ? `/calls/live?${s}` : '/calls/live'
  }

  // Each train's heading, worked out before rendering so a heading can be
  // decided by looking at the train before it, without state carried through
  // the render.
  const buckets = pageRuns.map(({ run }) => arrivalBucket(board.timingOf(run).effectiveArrival, board.loadedAt))

  return (
    <div className="space-y-4">
      <PageHeader
        title="Live board"
        note={
          showUpcoming
            ? 'Orders booked for a later date.'
            : showYesterday
              ? `Yesterday · ${formatServiceDate(yesterday)}`
              : filtered
                ? `${formatServiceDate(today)} · showing ${shownOrders} of ${inScope.length} open orders`
                : `${formatServiceDate(today)} · ${inScope.length} open order${inScope.length === 1 ? '' : 's'}`
        }
        action={<AutoRefresh renderedAt={renderedAt} />}
      />

      <Tabs
        label="Service day"
        tabs={[
          { href: dateHref({ yesterday: false, upcoming: false }), label: 'Today', count: todayCount, active: !showUpcoming && !showYesterday },
          { href: dateHref({ yesterday: true }), label: 'Yesterday', count: yesterdayCount, active: showYesterday },
          { href: dateHref({ yesterday: false, upcoming: true }), label: 'Upcoming', count: upcomingCount, active: showUpcoming },
        ]}
        action={<GroupByTrainToggle href={groupHref(isGrouped ? '0' : '')} isGrouped={isGrouped} />}
      />

      <StaleNotice renderedAt={renderedAt} />
      <TrainFeedNotice simulated={isSimulatedProvider()} health={board.feedHealth} />

      <LiveToolbar
        filter={filter}
        outlets={outlets}
        counts={counts}
        targetId={BOARD_ID}
        dateQuery={showYesterday ? 'yesterday=1' : showUpcoming ? 'upcoming=1' : ''}
      />

      {(isGrouped ? pageRuns.length : pageFlatRows.length) === 0 ? (
        filtered ? (
          <EmptyState
            title="Nothing matches"
            note="No passenger on the board fits these filters. Try a shorter search, or clear the filters."
            action={<ButtonLink href="/calls/live">Clear all</ButtonLink>}
          />
        ) : (
          <EmptyState
            title={showUpcoming ? 'Nothing booked ahead' : showYesterday ? 'Nothing from yesterday' : 'No orders to call'}
            note={
              showUpcoming
                ? 'Bulk orders booked for a later date appear here.'
                : showYesterday
                  ? 'Orders from the previous service day show here, including any still open after midnight.'
                  : 'Orders appear here as they arrive at the outlets you cover, grouped by the train they are on.'
            }
          />
        )
      ) : isGrouped ? (
        <div id={BOARD_ID} className="space-y-3">
          {pageRuns.map(({ run, rows }, i) => {
            const bucket = buckets[i]
            const startsSection = i === 0 || bucket !== buckets[i - 1]
            const sectionTrains = buckets.filter((b) => b === bucket).length
            const counts = rows.reduce<Record<string, number>>((acc, r) => {
              acc[r.status] = (acc[r.status] ?? 0) + 1
              return acc
            }, {})
            const called = rows.filter(isCalled).length

            return (
              // Headings sit beside the cards in one flat keyed list, not
              // around them, so a train drifting from one section to the next
              // keeps its folded/open state through the board's refresh.
              <Fragment key={run.key}>
                {startsSection ? (
                  <div className="flex items-center gap-3 pt-3 first:pt-0">
                    <h2 className="text-sm font-semibold text-ink">{BUCKET_LABEL[bucket]}</h2>
                    <span className="text-sm tabular-nums text-muted">
                      {sectionTrains} train{sectionTrains === 1 ? '' : 's'}
                    </span>
                    <span aria-hidden className="h-px flex-1 bg-line-strong/60" />
                  </div>
                ) : null}
                <TrainRunFrame
                  run={{
                    trainNo: run.trainNo,
                    trainName: run.trainName,
                    stationCode: run.stationCode,
                    timing: board.timingOf(run),
                  }}
                  orderCount={rows.length}
                  itemCount={rows.reduce((sum, r) => sum + r.itemCount, 0)}
                  // Open while there is someone left to ring, or while the
                  // person is searching and needs to see what matched.
                  collapsible={{ open: filtered || called < rows.length }}
                  copyText={`${run.trainNo ?? 'No train no.'} ${run.trainName ?? ''} · ${run.stationCode}`.trim()}
                  headerNote={<RunSummary counts={counts} called={called} total={rows.length} />}
                >
                  {rows.map((row) => (
                    <CallBoardRow key={row.id} order={row} />
                  ))}
                </TrainRunFrame>
              </Fragment>
            )
          })}
        </div>
      ) : (
        // Flat: one row per order, newest-arriving train first (same order
        // the grouped view already sorts trains in), each row carrying its
        // own train number since there is no train header above it here.
        <Card className="overflow-hidden">
          <ul id={BOARD_ID} className="divide-y divide-line">
            {pageFlatRows.map((row) => (
              <CallBoardRow key={row.id} order={row} trainNo={row.trainNo} trainName={row.trainName} />
            ))}
          </ul>
        </Card>
      )}

      {total > 0 ? (
        <Card>
          <Pagination page={page} pageSize={pageSize} total={total} buildHref={pageHref} />
        </Card>
      ) : null}
    </div>
  )
}

/**
 * One line under a train: how many have been rung, and how its orders stand.
 * Written in words beside the count so the ratio reads without colour.
 */
function RunSummary({
  counts,
  called,
  total,
}: {
  counts: Record<string, number>
  called: number
  total: number
}) {
  const done = called === total
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      <span
        className={`rounded-full px-1.5 py-0.5 font-semibold tabular-nums ring-1 ring-inset ${
          done ? 'bg-emerald-50 text-emerald-900 ring-emerald-200' : 'bg-amber-50 text-amber-900 ring-amber-200'
        }`}
      >
        {called} of {total} called
      </span>
      {Object.entries(counts).map(([status, n]) => (
        <span key={status} className="tabular-nums">
          {n} {statusLabel(status).toLowerCase()}
        </span>
      ))}
    </p>
  )
}
