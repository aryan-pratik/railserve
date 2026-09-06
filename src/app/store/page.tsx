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
  const { upcoming, group } = await props.searchParams

  const today = todayIST()
  const showUpcoming = upcoming === '1'
  const groupParam = typeof group === 'string' ? group : ''
  const isGrouped = groupParam !== '0'
  const multiOutlet = ctx.restaurantIds.length > 1

  // The inactive tab needs a number, not its rows: a count, not a second
  // full load of up to 500 documents.
  const otherDay = showUpcoming ? { serviceDate: today } : { serviceDate: { $gt: today } }

  await connectDb()
  // Everything that does not depend on the runs goes out in the same round trip.
  const [runs, otherCount, riderDocs, feedHealth, outlets] = await Promise.all([
    showUpcoming ? findUpcomingRuns(ctx, today) : findRuns(ctx, today),
    countOrders(ctx, { ...otherDay, status: { $in: LIVE_STATUSES } }),
    User.find({
      role: 'DELIVERY_AGENT',
      active: true,
      ...(ctx.role === 'STORE_MANAGER' ? { restaurantIds: { $in: ctx.restaurantIds } } : {}),
    })
      .select('name')
      .sort({ name: 1 })
      .lean(),
    trainFeedHealth(),
    // Outlet names only matter to a manager who holds more than one.
    multiOutlet
      ? Restaurant.find({ _id: { $in: ctx.restaurantIds } }).select('name').lean()
      : Promise.resolve([]),
  ])

  const riders = riderDocs.map((r) => ({ id: String(r._id), name: r.name }))
  const allOrders = runs.flatMap((r) => r.orders)
  const timings = await timingForOrders(allOrders)
  const outletName = new Map(outlets.map((o) => [String(o._id), o.name]))

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

  // Same orders as the grouped cards, one row per order, sorted the same way.
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
        title="Kitchen board"
        note={showUpcoming ? 'Orders booked for a later date.' : formatServiceDate(today)}
        action={
          <>
            <AutoRefresh seconds={30} />
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
          { href: '/store', label: 'Today', count: showUpcoming ? otherCount : orderCount, active: !showUpcoming },
          { href: '/store?upcoming=1', label: 'Upcoming', count: showUpcoming ? orderCount : otherCount, active: showUpcoming },
        ]}
        action={<GroupByTrainToggle href={groupHref(isGrouped ? '0' : '')} isGrouped={isGrouped} />}
      />

      <TrainFeedNotice simulated={isSimulatedProvider()} health={feedHealth} />

      {sorted.length === 0 ? (
        <EmptyState
          title={showUpcoming ? 'Nothing booked ahead' : 'No orders yet today'}
          note={
            showUpcoming
              ? 'Bulk orders booked for a later date appear here.'
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
