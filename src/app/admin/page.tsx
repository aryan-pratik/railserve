import Link from 'next/link'
import { requireRole } from '@/lib/session'
import { findMany, countOrders } from '@/lib/repo/orderRepo'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'
import { timingForOrders, timingFor } from '@/lib/train/service'
import { groupIntoRuns, sortRunsByUrgency } from '@/lib/runs'
import { todayIST, formatDateRange, formatTimeIST } from '@/lib/format'
import { resolveDateRange, type DateFilterMode } from '@/lib/dateFilter'
import { AutoRefresh } from '@/components/AutoRefresh'
import { ButtonLink, EmptyState, PageHeader } from '@/components/ui'
import { IconPlus } from '@/components/Icons'
import { OrdersTable } from '@/components/OrdersTable'
import { TrainGroups, type TrainGroup } from './TrainGroups'
import { OrdersToolbar } from './OrdersToolbar'
import { forceRefreshOrderTrain } from './orders/[id]/actions'
import type { QueryFilter } from 'mongoose'

export const metadata = { title: 'Orders · RailServe' }

const TABS = [
  { key: '', label: 'All', statuses: null as string[] | null },
  { key: 'kitchen', label: 'Preparing', statuses: ['ACCEPTED', 'KOT_PRINTED', 'PREPARED'] },
  { key: 'platform', label: 'On the way', statuses: ['DISPATCHED'] },
  { key: 'delivered', label: 'Delivered', statuses: ['DELIVERED'] },
  { key: 'issues', label: 'Cancelled', statuses: ['FAILED', 'CANCELLED', 'LOST'] },
]

export default async function AdminOrdersPage(props: PageProps<'/admin'>) {
  const ctx = await requireRole('ADMIN')
  const sp = await props.searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''

  const today = todayIST()
  const tabKey = one(sp.tab)
  const isUpcoming = one(sp.upcoming) === '1'
  const mode = (one(sp.mode) || 'today') as DateFilterMode
  const month = one(sp.month)
  const rangeFrom = one(sp.from)
  const rangeTo = one(sp.to)
  const resolvedRange = resolveDateRange(mode, { month, from: rangeFrom, to: rangeTo })
  const activeFrom = resolvedRange.from || today
  const activeTo = resolvedRange.to || today
  const activeDateLabel = formatDateRange(activeFrom, activeTo)
  const outlet = one(sp.outlet)
  const train = one(sp.train)
  const payment = one(sp.payment)
  const sort = one(sp.sort) || 'urgent'
  const q = one(sp.q).trim()
  const group = one(sp.group)
  const isGrouped = group !== '0'

  const tab = TABS.find((t) => t.key === tabKey) ?? TABS[0]

  const dayFilter: QueryFilter<Record<string, unknown>> = isUpcoming
    ? { serviceDate: { $gt: today } }
    : { serviceDate: { $gte: activeFrom, $lte: activeTo } }

  if (outlet) dayFilter.restaurantId = outlet
  if (train) dayFilter.trainNo = train
  if (payment) dayFilter.paymentMode = payment
  if (q) {
    dayFilter.$or = [
      { externalOrderId: { $regex: q, $options: 'i' } },
      { trainNo: { $regex: q, $options: 'i' } },
      { contactName: { $regex: q, $options: 'i' } },
      { contactPhone: { $regex: q, $options: 'i' } },
    ]
  }

  await connectDb()
  // Independent reads, so they go out together rather than one after another.
  const [outlets, dayOrders, todayCount, upcomingCount] = await Promise.all([
    Restaurant.find({}).select('name stationCode').sort({ name: 1 }).lean(),
    findMany(ctx, dayFilter, { sort: { createdAt: 1 }, limit: 500 }),
    countOrders(ctx, { serviceDate: today, status: { $ne: 'CANCELLED' } }),
    countOrders(ctx, { serviceDate: { $gt: today }, status: { $ne: 'CANCELLED' } }),
  ])

  const visible = tab.statuses
    ? dayOrders.filter((o) => tab.statuses!.includes(o.status))
    : dayOrders

  const timings = await timingForOrders(visible)
  const outletName = new Map(outlets.map((o) => [String(o._id), o.name]))
  const trainNos = [
    ...new Set(dayOrders.map((o) => o.trainNo).filter((t): t is string => Boolean(t))),
  ].sort()

  const serverNow = new Date().toISOString()

  const runs = groupIntoRuns(visible)
  const ordered =
    sort === 'newest'
      ? [...runs].sort(
          (a, b) => (b.orders[0]?.createdAt?.getTime() ?? 0) - (a.orders[0]?.createdAt?.getTime() ?? 0),
        )
      : sortRunsByUrgency(runs, (r) => timingFor(r.orders[0], timings).effectiveArrival)

  const groups: TrainGroup[] = ordered.map((run) => {
    const t = timingFor(run.orders[0], timings)
    return {
      key: run.key,
      trainNo: run.trainNo,
      trainName: run.trainName,
      stationCode: run.stationCode,
      outletNames: [
        ...new Set(
          run.orders.map((o) => outletName.get(String(o.restaurantId)) ?? '').filter(Boolean),
        ),
      ],
      arrivalLabel: formatTimeIST(t.effectiveArrival),
      // Only when the live ETA has actually moved off the booked time;
      // otherwise the card would print the same time twice.
      bookedLabel:
        t.scheduledArrival && t.effectiveArrival &&
        t.scheduledArrival.getTime() !== t.effectiveArrival.getTime()
          ? formatTimeIST(t.scheduledArrival)
          : null,
      delayMinutes: t.delayMinutes,
      platform: t.platform,
      arrivalIso: t.effectiveArrival?.toISOString() ?? null,
      checkedAtIso: t.checkedAt?.toISOString() ?? null,
      nextCheckAtIso: t.nextCheckAt?.toISOString() ?? null,
      arrived: t.arrived,
      orders: run.orders.map((o) => ({
        id: String(o._id),
        externalOrderId: o.externalOrderId,
        orderType: o.orderType,
        contactName: o.contactName ?? null,
        contactPhone: o.contactPhone ?? null,
        coach: o.coach ?? null,
        berth: o.berth ?? null,
        rawSeat: o.rawSeat ?? null,
        handoverPoint: o.handoverPoint ?? null,
        itemCount: o.items.filter((i) => !i.isPacking).length,
        itemNames: o.items
          .filter((i) => !i.isPacking)
          .map((i) => (i.qty > 1 ? `${i.name} ×${i.qty}` : i.name)),
        pax: o.pax ?? null,
        amountPaise: o.amountPaise ?? null,
        paymentMode: o.paymentMode ?? null,
        status: o.status,
        outletName: outletName.get(String(o.restaurantId)) ?? null,
        orderTimeLabel: formatTimeIST(o.createdAt),
        isNew: o.status === 'RECEIVED',
      })),
    }
  })

  const counts = new Map(
    TABS.map((t) => [
      t.key,
      t.statuses ? dayOrders.filter((o) => t.statuses!.includes(o.status)).length : dayOrders.length,
    ]),
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="Orders"
        note={isUpcoming ? 'Booked for a later date.' : activeDateLabel}
        action={
          <>
            <AutoRefresh seconds={30} />
            <ButtonLink href="/admin/orders/new" variant="primary">
              <IconPlus size={15} />
              New order
            </ButtonLink>
          </>
        }
      />

      <OrdersToolbar
        tabs={TABS.map((t) => ({
          key: t.key,
          label: t.label,
          count: counts.get(t.key) ?? 0,
          active: t.key === tab.key,
        }))}
        outlets={outlets.map((o) => ({ id: String(o._id), label: `${o.name} · ${o.stationCode}` }))}
        trains={trainNos}
        current={{ tab: tabKey, mode, month, from: rangeFrom, to: rangeTo, outlet, train, payment, sort, q, group, upcoming: isUpcoming ? '1' : '' }}
        todayCount={todayCount}
        upcomingCount={upcomingCount}
      />

      {visible.length === 0 ? (
        <EmptyState
          title={isUpcoming ? 'Nothing booked ahead' : 'No orders'}
          note={
            q || outlet || train || payment
              ? 'Nothing matches these filters.'
              : isUpcoming
                ? 'Bulk orders booked for a later date appear here.'
                : `No orders for ${activeDateLabel}. New orders appear here as they arrive.`
          }
          action={
            q || outlet || train || payment ? (
              <ButtonLink href="/admin">Clear filters</ButtonLink>
            ) : (
              <ButtonLink href="/admin/orders/new" variant="primary">New order</ButtonLink>
            )
          }
        />
      ) : isGrouped ? (
        <TrainGroups groups={groups} serverNow={serverNow} refreshAction={forceRefreshOrderTrain} />
      ) : (
        <OrdersTable
          orders={visible.map((o) => ({
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
            outletName: outletName.get(String(o.restaurantId)) ?? null,
            remark: o.remark,
          }))}
          hrefFor={(id) => `/admin/orders/${id}`}
          showOutlet
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 text-xs text-muted">
        <span>
          {isGrouped ? `${groups.length} train${groups.length === 1 ? '' : 's'} · ` : ''}
          {visible.length} order{visible.length === 1 ? '' : 's'}
          {isUpcoming ? ' booked ahead' : ` on ${activeDateLabel}`}
        </span>
        <Link href="/admin/orders" className="font-medium text-accent underline-offset-2 hover:underline">
          Search across all dates
        </Link>
      </div>
    </div>
  )
}
