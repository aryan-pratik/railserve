import Link from 'next/link'
import { requireRole } from '@/lib/session'
import { findMany, countOrders } from '@/lib/repo/orderRepo'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'
import { timingForOrders, timingFor } from '@/lib/train/service'
import { groupIntoRuns, sortRunsByUrgency } from '@/lib/runs'
import { todayIST, formatServiceDate, formatTimeIST } from '@/lib/format'
import { resolveDateRange, type DateFilterMode } from '@/lib/dateFilter'
import { AutoRefresh } from '@/components/AutoRefresh'
import { ButtonLink, EmptyState } from '@/components/ui'
import { OrdersTable } from '@/components/OrdersTable'
import { TrainGroups, type TrainGroup } from './TrainGroups'
import { OrdersToolbar } from './OrdersToolbar'
import { forceRefreshOrderTrain } from './orders/[id]/actions'
import type { QueryFilter } from 'mongoose'

export const metadata = { title: 'Orders · RailServe' }

const TABS = [
  { key: '', label: 'All Orders', statuses: null as string[] | null },
  { key: 'kitchen', label: 'Preparing', statuses: ['ACCEPTED', 'KOT_PRINTED', 'PREPARED'] },
  { key: 'platform', label: 'On the Way', statuses: ['DISPATCHED'] },
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
  const activeDateLabel =
    activeFrom === activeTo
      ? formatServiceDate(activeFrom)
      : `${formatServiceDate(activeFrom)} – ${formatServiceDate(activeTo)}`
  const outlet = one(sp.outlet)
  const train = one(sp.train)
  const payment = one(sp.payment)
  const sort = one(sp.sort) || 'urgent'
  const q = one(sp.q).trim()
  const group = one(sp.group)
  const isGrouped = group !== '0'

  const tab = TABS.find((t) => t.key === tabKey) ?? TABS[0]

  await connectDb()
  const outlets = await Restaurant.find({}).select('name stationCode').sort({ name: 1 }).lean()

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

  const [dayOrders, todayCount, upcomingCount] = await Promise.all([
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
      // Only when the live ETA has actually moved off the booked time —
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

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-ink">Orders</h1>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200/60">
              <span className="size-2 rounded-full bg-emerald-600 animate-pulse" aria-hidden />
              Live
            </span>
          </div>
          <p className="mt-0.5 text-xs sm:text-sm text-muted">
            Manage and track all customer orders
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <AutoRefresh seconds={30} />
          <ButtonLink href="/admin/orders/new" variant="primary" className="rounded-xl shadow-2xs">
            + New Order
          </ButtonLink>
        </div>
      </header>

      {/* Toolbar & Filters */}
      <OrdersToolbar
        tabs={TABS.map((t) => ({
          key: t.key,
          label: t.label,
          count: t.statuses
            ? dayOrders.filter((o) => t.statuses!.includes(o.status)).length
            : dayOrders.length,
          active: t.key === tab.key,
        }))}
        outlets={outlets.map((o) => ({ id: String(o._id), label: `${o.name} — ${o.stationCode}` }))}
        trains={trainNos}
        current={{ tab: tabKey, mode, month, from: rangeFrom, to: rangeTo, outlet, train, payment, sort, q, group, upcoming: isUpcoming ? '1' : '' }}
        todayCount={todayCount}
        upcomingCount={upcomingCount}
      />

      {/* Orders Content (Grouped by Train or Flat List) */}
      {visible.length === 0 ? (
        <EmptyState
          title={isUpcoming ? 'No upcoming orders found' : 'No orders found'}
          note={
            q || outlet || train || payment
              ? 'No orders match your selected filters. Try clearing filters.'
              : isUpcoming
              ? 'Bulk orders booked for future dates will appear here automatically.'
              : `No orders for ${activeDateLabel}. New orders will appear here automatically.`
          }
          action={<ButtonLink href="/admin/orders/new" variant="primary">+ Add Order</ButtonLink>}
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

      {/* Footer Summary */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-xs text-muted border-t border-line">
        <span>
          Showing {isGrouped ? `${groups.length} train${groups.length === 1 ? '' : 's'} · ` : ''}
          {visible.length} order{visible.length === 1 ? '' : 's'}
          {isUpcoming ? ' (Upcoming)' : ` for ${activeDateLabel}`}
        </span>
        <Link
          href="/admin/orders"
          className="font-semibold text-accent underline-offset-2 hover:underline"
        >
          Search across all dates →
        </Link>
      </div>
    </div>
  )
}
