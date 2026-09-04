import { requireRole } from '@/lib/session'
import { findRuns, findUpcomingRuns, LIVE_STATUSES } from '@/lib/repo/runRepo'
import { countOrders } from '@/lib/repo/orderRepo'
import { connectDb } from '@/lib/db'
import { Restaurant, User } from '@/lib/models'
import { timingForOrders, timingFor, trainFeedHealth } from '@/lib/train/service'
import { sortRunsByUrgency } from '@/lib/runs'
import { todayIST, formatServiceDate } from '@/lib/format'
import { isSimulatedProvider } from '@/lib/train'
import { TrainFeedNotice } from '@/components/TrainFeedNotice'
import { TrainRunCard, type RunCardData } from '@/components/TrainRunCard'
import { OrdersTable } from '@/components/OrdersTable'
import { GroupByTrainToggle } from '@/components/GroupByTrainToggle'
import { OrderFeed } from '@/components/OrderFeed'
import { AutoRefresh } from '@/components/AutoRefresh'
import { env } from '@/lib/env'
import { ButtonLink, EmptyState, PageHeader, Tabs } from '@/components/ui'
import { StoreRunActions } from './StoreRunActions'
import { forceRefreshOrderTrain } from './actions'
import { RefreshTrainButton } from '@/components/RefreshTrainButton'

export const metadata = { title: 'Board · RailServe' }

/**
 * The store board.
 *
 * One card per train, ordered by when the train actually arrives — not by when
 * the order came in, and not by the timetable. A train running 90 minutes late
 * drops below one that is on time, because the food that leaves first is the
 * food that should be cooked first.
 */
export default async function StoreBoardPage(props: PageProps<'/store'>) {
  const ctx = await requireRole('STORE_MANAGER', 'ADMIN')
  const { upcoming, group } = await props.searchParams

  const today = todayIST()
  const showUpcoming = upcoming === '1'
  const groupParam = typeof group === 'string' ? group : ''
  const isGrouped = groupParam !== '0'

  // The inactive tab needs a number, not its rows — so it gets a count, not a
  // second full load of up to 500 documents.
  const otherDay = showUpcoming
    ? { serviceDate: today }
    : { serviceDate: { $gt: today } }

  const [runs, otherCount] = await Promise.all([
    showUpcoming ? findUpcomingRuns(ctx, today) : findRuns(ctx, today),
    countOrders(ctx, { ...otherDay, status: { $in: LIVE_STATUSES } }),
  ])

  const riderDocs = await User.find({
    role: 'DELIVERY_AGENT',
    active: true,
    ...(ctx.role === 'STORE_MANAGER' ? { restaurantIds: { $in: ctx.restaurantIds } } : {}),
  })
    .select('name')
    .sort({ name: 1 })
    .lean()
  const riders = riderDocs.map((r) => ({ id: String(r._id), name: r.name }))

  const allOrders = runs.flatMap((r) => r.orders)
  const [timings, feedHealth] = await Promise.all([
    timingForOrders(allOrders),
    trainFeedHealth(),
  ])

  // Outlet names only matter to a manager who holds more than one.
  await connectDb()
  const multiOutlet = ctx.restaurantIds.length > 1
  const outletName = new Map<string, string>()
  if (multiOutlet) {
    const outlets = await Restaurant.find({ _id: { $in: ctx.restaurantIds } })
      .select('name')
      .lean()
    for (const o of outlets) outletName.set(String(o._id), o.name)
  }

  const cards: RunCardData[] = runs.map((run) => ({
    key: run.key,
    trainNo: run.trainNo,
    trainName: run.trainName,
    stationCode: run.stationCode,
    timing: timingFor(run.orders[0], timings),
    orders: run.orders.map((o) => ({
      id: String(o._id),
      externalOrderId: o.externalOrderId,
      orderType: o.orderType,
      status: o.status,
      coach: o.coach,
      berth: o.berth,
      handoverPoint: o.handoverPoint,
      pax: o.pax,
      contactName: o.contactName,
      itemCount: o.items.filter((i) => !i.isPacking).length,
      amountPaise: o.amountPaise,
      paymentMode: o.paymentMode,
      outletName: multiOutlet ? (outletName.get(String(o.restaurantId)) ?? null) : null,
    })),
  }))

  const sorted = sortRunsByUrgency(cards, (c) => c.timing.effectiveArrival)
  const statusCounts = new Map(runs.map((r) => [r.key, r.statusCounts]))
  const orderCount = allOrders.length

  // Same underlying orders as the grouped cards, just one row per order
  // instead of one card per train — sorted the same way, soonest-arriving
  // (and not-yet-arrived) first.
  const flatOrders = sortRunsByUrgency(allOrders, (o) => timingFor(o, timings).effectiveArrival)

  const groupHref = (g: string) => {
    const u = new URLSearchParams()
    if (showUpcoming) u.set('upcoming', '1')
    if (g) u.set('group', g)
    const s = u.toString()
    return s ? `/store?${s}` : '/store'
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={showUpcoming ? 'Upcoming' : 'Today'}
        note={showUpcoming ? 'Orders booked for a later date.' : formatServiceDate(today)}
        action={<ButtonLink href="/store/orders/new" variant="primary">+ New order</ButtonLink>}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          tabs={[
            { href: '/store', label: 'Today', count: showUpcoming ? otherCount : orderCount, active: !showUpcoming },
            { href: '/store?upcoming=1', label: 'Upcoming', count: showUpcoming ? orderCount : otherCount, active: showUpcoming },
          ]}
        />
        <div className="flex items-center gap-3">
          <GroupByTrainToggle href={groupHref(isGrouped ? '0' : '')} isGrouped={isGrouped} />
          <span className="h-4 w-px bg-line" aria-hidden="true" />
          <AutoRefresh seconds={30} />
          <OrderFeed />
        </div>
      </div>

      <TrainFeedNotice simulated={isSimulatedProvider()} health={feedHealth} />

      {sorted.length === 0 ? (
        <EmptyState
          title={showUpcoming ? 'Nothing booked ahead' : 'No orders yet today'}
          note={
            showUpcoming
              ? 'Bulk orders booked for a later date will appear here.'
              : 'New orders appear here the moment they arrive, grouped by train.'
          }
          action={<ButtonLink href="/store/orders/new" variant="primary">Add one by hand</ButtonLink>}
        />
      ) : isGrouped ? (
        <div className="space-y-3">
          {sorted.map((card) => (
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
          orders={flatOrders.map((o) => ({
            id: String(o._id),
            externalOrderId: o.externalOrderId,
            orderType: o.orderType,
            status: o.status,
            serviceDate: o.serviceDate,
            trainNo: o.trainNo,
            coach: o.coach,
            berth: o.berth,
            contactName: o.contactName,
            scheduledArrival: o.scheduledArrival,
            amountPaise: o.amountPaise,
            outletName: multiOutlet ? (outletName.get(String(o.restaurantId)) ?? null) : null,
            remark: o.remark,
          }))}
          hrefFor={(id) => `/store/orders/${id}`}
          showOutlet={multiOutlet}
        />
      )}
    </div>
  )
}
