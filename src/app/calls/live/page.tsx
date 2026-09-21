import { Fragment } from 'react'
import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { User } from '@/lib/models'
import { formatServiceDate, todayIST } from '@/lib/format'
import { callBoardRow } from '@/lib/orderView'
import { countLive, loadRunBoard } from '@/lib/board'
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
import { ButtonLink, Card, EmptyState, PageHeader, Pagination, statusLabel } from '@/components/ui'
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
 * Trains are sectioned by how soon they arrive, so the page has an order you
 * can read at a glance, and each folds away: a train whose passengers have all
 * been rung starts folded, because there is nothing left to do on it.
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

  // Cache-only timing: this desk reads the train feed, it never spends the
  // provider quota. The train-poll cron keeps the same rows warm for the
  // kitchen board.
  const [board, openCount] = await Promise.all([
    loadRunBoard(ctx, 'today', { allowFetch: false }),
    countLive(ctx),
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

  // Every passenger, projected once. The outlet and the search narrow what the
  // chip counts describe; the chips then narrow it further, so a chip's count
  // is what you would get by pressing it.
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

  const scopeOnly = { ...filter, call: 'all' as const, status: 'all' as const }
  const inScope = shaped.flatMap(({ run, rows }) => rows.filter((r) => rowMatches(r, run, scopeOnly)))
  const countCall = (state: CallState) =>
    inScope.filter((r) => rowMatches(r, { trainNo: null, trainName: null }, { ...scopeOnly, call: state, q: '' })).length
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

  const outlets = board.multiOutlet
    ? [...board.outletName.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
    : []

  const pageHref = (target: { page: number; pageSize: number }) => {
    const u = new URLSearchParams()
    if (filter.q) u.set('q', filter.q)
    if (filter.call !== 'all') u.set('call', filter.call)
    if (filter.status !== 'all') u.set('status', filter.status)
    if (filter.outlet) u.set('outlet', filter.outlet)
    const s = withPage(u, target).toString()
    return s ? `/calls/live?${s}` : '/calls/live'
  }

  // Each train's heading, worked out before rendering so a heading can be
  // decided by looking at the train before it, without state carried through
  // the render.
  const buckets = pageRuns.map(({ run }) => arrivalBucket(board.timingOf(run).effectiveArrival, board.loadedAt))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Live board"
        note={
          filtered
            ? `${formatServiceDate(todayIST())} · showing ${shownOrders} of ${openCount} open orders`
            : `${formatServiceDate(todayIST())} · ${openCount} open order${openCount === 1 ? '' : 's'}`
        }
        action={
          <>
            <AutoRefresh renderedAt={renderedAt} />
            <ButtonLink href="/calls">Call list</ButtonLink>
          </>
        }
      />

      <StaleNotice renderedAt={renderedAt} />
      <TrainFeedNotice simulated={isSimulatedProvider()} health={board.feedHealth} />

      <LiveToolbar filter={filter} outlets={outlets} counts={counts} targetId={BOARD_ID} />

      {pageRuns.length === 0 ? (
        filtered ? (
          <EmptyState
            title="Nothing matches"
            note="No passenger on the board fits these filters. Try a shorter search, or clear the filters."
            action={<ButtonLink href="/calls/live">Clear all</ButtonLink>}
          />
        ) : (
          <EmptyState
            title="No orders to call"
            note="Orders appear here as they arrive at the outlets you cover, grouped by the train they are on."
          />
        )
      ) : (
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
      )}

      {visible.length > 0 ? (
        <Card>
          <Pagination page={page} pageSize={pageSize} total={visible.length} buildHref={pageHref} />
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
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
      <span
        className={`rounded-full px-2.5 py-0.5 font-semibold tabular-nums ring-1 ring-inset ${
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
