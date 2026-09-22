import { requireRole } from '@/lib/session'
import { LIVE_STATUSES } from '@/lib/repo/runRepo'
import { countOrders } from '@/lib/repo/orderRepo'
import { connectDb } from '@/lib/db'
import { User } from '@/lib/models'
import { timingFor } from '@/lib/train/service'
import { sortRunsByUrgency } from '@/lib/runs'
import { todayIST, formatServiceDate, shiftServiceDate } from '@/lib/format'
import { countLive, loadRunBoard, type BoardMode } from '@/lib/board'
import { inRollover } from '@/lib/liveDay'
import { callNoteRow } from '@/lib/orderView'
import { isSimulatedProvider } from '@/lib/train'
import { TrainFeedNotice } from '@/components/TrainFeedNotice'
import { TrainRunCard, type RunCardData } from '@/components/TrainRunCard'
import { OrdersTable } from '@/components/OrdersTable'
import { GroupByTrainToggle } from '@/components/GroupByTrainToggle'
import { OrderFeed } from '@/components/OrderFeed'
import { AutoRefresh, StaleNotice } from '@/components/AutoRefresh'
import { env } from '@/lib/env'
import { ButtonLink, EmptyState, PageHeader, Pagination, Tabs } from '@/components/ui'
import { readPage, withPage } from '@/lib/pagination'
import { IconPlus } from '@/components/Icons'
import { StoreRunActions } from './StoreRunActions'
import { forceRefreshOrderTrain } from './actions'
import { RefreshTrainButton } from '@/components/RefreshTrainButton'

export const metadata = { title: 'Kitchen board · RailServe' }

/**
 * The kitchen board.
 *
 * One card per train, ordered by when the train actually arrives, not by when
 * the order came in and not by the timetable. A train running 90 minutes late
 * drops below one that is on time, because the food that leaves first is the
 * food that should be cooked first.
 */
export default async function StoreBoardPage(props: PageProps<'/store'>) {
  const ctx = await requireRole('STORE_MANAGER', 'ADMIN')
  const sp = await props.searchParams
  const { upcoming, yesterday: yesterdayParam, group } = sp
  const { page, pageSize, skip } = readPage(sp)

  const today = todayIST()
  // The service day before today, in IST. Past midnight, last night's orders
  // that are still open leave the Today tab; this is where they can be found.
  const yesterday = shiftServiceDate(today, -1)
  const showYesterday = yesterdayParam === '1'
  const showUpcoming = !showYesterday && upcoming === '1'
  const groupParam = typeof group === 'string' ? group : ''
  const isGrouped = groupParam !== '0'
  const multiOutlet = ctx.restaurantIds.length > 1

  // Today and Upcoming badge what is still open, so each is its own cheap
  // count rather than the length of whichever tab's rows are loaded. Yesterday
  // badges every order from that day, open or finished, matching what its tab
  // actually lists — a manager checking back on last night wants the whole
  // count, not just what is still outstanding.
  const live = { status: { $in: LIVE_STATUSES } }
  const mode: BoardMode = showUpcoming ? 'upcoming' : showYesterday ? 'yesterday' : 'today'

  await connectDb()
  // Everything that does not depend on the runs goes out in the same round trip.
  const [board, todayCount, yesterdayCount, upcomingCount, riderDocs] = await Promise.all([
    loadRunBoard(ctx, mode),
    // The same count the call board and admin show: today, plus last night's
    // open orders until the past-midnight window closes.
    countLive(ctx),
    // While last night's open orders are inside Today, counting them here too
    // would show the same orders on two tabs.
    inRollover() ? Promise.resolve(undefined) : countOrders(ctx, { serviceDate: yesterday }),
    countOrders(ctx, { serviceDate: { $gt: today }, ...live }),
    User.find({
      role: 'DELIVERY_AGENT',
      active: true,
      ...(ctx.role === 'STORE_MANAGER' ? { restaurantIds: { $in: ctx.restaurantIds } } : {}),
    })
      .select('name')
      .sort({ name: 1 })
      .lean(),
  ])
  const { runs, timings, outletName } = board
  const renderedAt = board.loadedAt.toISOString()

  const riders = riderDocs.map((r) => ({ id: String(r._id), name: r.name }))
  const allOrders = runs.flatMap((r) => r.orders)

  const cards: RunCardData[] = runs.map((run) => ({
    key: run.key,
    trainNo: run.trainNo,
    trainName: run.trainName,
    stationCode: run.stationCode,
    timing: board.timingOf(run),
    orders: run.orders.map((o) => ({
      id: String(o._id),
      externalOrderId: o.externalOrderId,
      orderType: o.orderType,
      status: o.status,
      coach: o.coach,
      berth: o.berth,
      rawSeat: o.rawSeat,
      handoverPoint: o.handoverPoint,
      pax: o.pax,
      contactName: o.contactName,
      itemCount: o.items.filter((i) => !i.isPacking).length,
      amountPaise: o.amountPaise,
      paymentMode: o.paymentMode,
      outletName: multiOutlet ? (outletName.get(String(o.restaurantId)) ?? null) : null,
            ...callNoteRow(o),
    })),
  }))

  // `runs` is already in urgency order, and `cards` follows it.
  const sorted = cards
  const statusCounts = new Map(runs.map((r) => [r.key, r.statusCounts]))

  // Same orders as the grouped cards, one row per order, sorted the same way.
  const flatOrders = sortRunsByUrgency(allOrders, (o) => timingFor(o, timings).effectiveArrival)

  // A page of the board is a page of whole trains in the grouped view, never
  // half a train: the run actions (accept all, hand over) act on the whole
  // run, and a run split across pages would act on orders out of sight. The
  // flat view pages by order. Both slice after the urgency sort, which needs
  // every run's live timing to put the right train first.
  const pageCards = sorted.slice(skip, skip + pageSize)
  const pageOrders = flatOrders.slice(skip, skip + pageSize)
  const total = isGrouped ? sorted.length : flatOrders.length

  const boardParams = (g: string) => {
    const u = new URLSearchParams()
    if (showUpcoming) u.set('upcoming', '1')
    if (showYesterday) u.set('yesterday', '1')
    if (g) u.set('group', g)
    return u
  }
  const toHref = (u: URLSearchParams) => {
    const s = u.toString()
    return s ? `/store?${s}` : '/store'
  }
  // Switching view starts at page one; the unit being counted has changed.
  const groupHref = (g: string) => toHref(withPage(boardParams(g), { page: 1, pageSize }))
  const pageHref = (target: { page: number; pageSize: number }) =>
    toHref(withPage(boardParams(isGrouped ? '' : '0'), target))

  return (
    <div className="space-y-4">
      <PageHeader
        title="Kitchen board"
        note={
          showUpcoming
            ? 'Orders booked for a later date.'
            : showYesterday
              ? `Yesterday · ${formatServiceDate(yesterday)}`
              : formatServiceDate(today)
        }
        action={
          <>
            <AutoRefresh renderedAt={renderedAt} />
            <OrderFeed />
            <ButtonLink href="/store/orders/new" variant="primary">
              <IconPlus size={15} />
              New order
            </ButtonLink>
          </>
        }
      />

      <Tabs
        label="Service day"
        tabs={[
          { href: '/store', label: 'Today', count: todayCount, active: !showUpcoming && !showYesterday },
          { href: '/store?yesterday=1', label: 'Yesterday', count: yesterdayCount, active: showYesterday },
          { href: '/store?upcoming=1', label: 'Upcoming', count: upcomingCount, active: showUpcoming },
        ]}
        action={<GroupByTrainToggle href={groupHref(isGrouped ? '0' : '')} isGrouped={isGrouped} />}
      />

      <StaleNotice renderedAt={renderedAt} />
      <TrainFeedNotice simulated={isSimulatedProvider()} health={board.feedHealth} />

      {sorted.length === 0 ? (
        <EmptyState
          title={showUpcoming ? 'Nothing booked ahead' : showYesterday ? 'Nothing from yesterday' : 'No orders yet today'}
          note={
            showUpcoming
              ? 'Bulk orders booked for a later date appear here.'
              : showYesterday
                ? 'Orders from the previous service day show here, including any still open after midnight.'
                : 'New orders appear here the moment they arrive, grouped by train.'
          }
          action={<ButtonLink href="/store/orders/new" variant="primary">Add one by hand</ButtonLink>}
        />
      ) : isGrouped ? (
        <div className="space-y-3">
          {pageCards.map((card) => (
            <TrainRunCard
              key={card.key}
              run={card}
              orderHref={(id) => `/store/orders/${id}`}
              refreshAction={
                card.orders[0] ? (
                  <RefreshTrainButton orderId={card.orders[0].id} action={forceRefreshOrderTrain} />
                ) : null
              }
              footer={
                <StoreRunActions
                  runKey={card.key}
                  counts={statusCounts.get(card.key) ?? {}}
                  trainNo={card.trainNo ?? null}
                  delayMinutes={card.timing.delayMinutes}
                  expectedArrival={card.timing.effectiveArrival?.toISOString() ?? null}
                  delayThresholdMinutes={env.KOT_DELAY_THRESHOLD_MINUTES}
                  riders={riders}
                />
              }
            />
          ))}
        </div>
      ) : (
        <OrdersTable
          orders={pageOrders.map((o) => ({
            id: String(o._id),
            externalOrderId: o.externalOrderId,
            orderType: o.orderType,
            status: o.status,
            serviceDate: o.serviceDate,
            trainNo: o.trainNo,
            coach: o.coach,
            berth: o.berth,
            rawSeat: o.rawSeat,
            contactName: o.contactName,
            scheduledArrival: o.scheduledArrival,
            amountPaise: o.amountPaise,
            outletName: multiOutlet ? (outletName.get(String(o.restaurantId)) ?? null) : null,
            remark: o.remark,
            ...callNoteRow(o),
          }))}
          hrefFor={(id) => `/store/orders/${id}`}
          showOutlet={multiOutlet}
        />
      )}

      {total > 0 ? (
        <div className="rounded-xl border border-line bg-surface">
          <Pagination page={page} pageSize={pageSize} total={total} buildHref={pageHref} />
        </div>
      ) : null}
    </div>
  )
}
