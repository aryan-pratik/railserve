import { requireRole } from '@/lib/session'
import { countByPaymentMode, countOrders, findMany } from '@/lib/repo/orderRepo'
import { connectDb } from '@/lib/db'
import { callNoteRow } from '@/lib/orderView'
import { AdminOrdersTable } from './AdminOrdersTable'
import { IconDownload, IconPlus } from '@/components/Icons'
import { ButtonAnchor, ButtonLink, Card, PageHeader, Pagination, Tabs, PAGE_SIZE_OPTIONS } from '@/components/ui'
import { OrderFilterBar } from '@/components/OrderFilterBar'
import { riderNamesFor } from '@/lib/repo/riderFilter'
import {
  hasOrderFilters, orderFilterClause, orderFilterOptions, orderFilterParams, readOrderFilters,
} from '@/lib/repo/orderFilters'
import type { QueryFilter } from 'mongoose'

/**
 * The payment modes an order can carry, in the order they are worth scanning.
 * Mirrors the PAYMENT_MODES union on the order model.
 */
const PAYMENT_TABS = [
  { value: '', label: 'All' },
  { value: 'COD', label: 'COD' },
  { value: 'PREPAID', label: 'Prepaid' },
  { value: 'INVOICE', label: 'Invoice' },
] as const

export const metadata = { title: 'All orders · RailServe' }

const DEFAULT_PAGE_SIZE = 20

/**
 * Lookup across every outlet.
 *
 * The board is where live work happens; this is where an order is found again
 * once it has left the board: a query, a refund, a reconciliation.
 */
export default async function AdminOrdersPage(props: PageProps<'/admin/orders'>) {
  const ctx = await requireRole('ADMIN')
  const sp = await props.searchParams

  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''
  // Opens on today, like every other dated screen; "All time" is one click.
  const filters = readOrderFilters(sp, { defaultMode: 'today' })
  const { q, mode } = filters
  const payment = one(sp.payment)

  const pageParam = Number.parseInt(one(sp.page), 10)
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1
  const pageSizeParam = Number.parseInt(one(sp.pageSize), 10)
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(pageSizeParam)
    ? pageSizeParam
    : DEFAULT_PAGE_SIZE

  // Filters are additive on top of the caller's scope, never instead of it.
  // Payment is layered on last and kept separable, because the tab counts are
  // taken from everything except it. Resolved before any query runs, so the
  // list, its count and the payment tab counts all read the very same filter.
  await connectDb()
  const base: QueryFilter<Record<string, unknown>> = await orderFilterClause(filters)

  const filter = payment ? { ...base, paymentMode: payment } : base

  const [options, orders, paymentCounts, totalCount] = await Promise.all([
    orderFilterOptions(ctx, filters.stations),
    findMany(ctx, filter, { sort: { createdAt: -1 }, limit: pageSize, skip: (page - 1) * pageSize }),
    countByPaymentMode(ctx, base),
    countOrders(ctx, filter),
  ])
  const riderName = await riderNamesFor(orders)
  const statusOptions = options.statuses
  const outletName = new Map(options.outlets.map((o) => [o.id, `${o.name} · ${o.stationCode}`]))

  // Today is the default, not a filter someone set.
  const hasFilters = hasOrderFilters(filters) || Boolean(payment)

  // Every link and the export carry the filters already in play.
  const query = (over: { payment?: string }) => {
    const u = orderFilterParams(filters)
    const p = over.payment ?? payment
    if (p) u.set('payment', p)
    return u.toString()
  }

  const paymentTabs = PAYMENT_TABS.map((t) => {
    const qs = query({ payment: t.value })
    return {
      href: `/admin/orders${qs ? `?${qs}` : ''}`,
      label: t.label,
      count: t.value
        ? (paymentCounts[t.value] ?? 0)
        : Object.values(paymentCounts).reduce((a, b) => a + b, 0),
      active: payment === t.value,
    }
  })

  // The export reads a missing mode as all time, so it always gets one.
  const exportQs = new URLSearchParams(query({}))
  exportQs.set('range', 'all')
  exportQs.set('mode', mode)
  const exportHref = `/admin/orders/export?${exportQs}`

  // Separate from `query()`: a filter change should always land back on page
  // 1, but the pager itself needs to carry the current page/size forward.
  const paginationHref = ({ page: p, pageSize: ps }: { page: number; pageSize: number }) => {
    const u = new URLSearchParams(query({}))
    if (p > 1) u.set('page', String(p))
    if (ps !== DEFAULT_PAGE_SIZE) u.set('pageSize', String(ps))
    const qs = u.toString()
    return `/admin/orders${qs ? `?${qs}` : ''}`
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="All orders"
        note={`${totalCount} order${totalCount === 1 ? '' : 's'}${
          hasFilters ? ' matching these filters' : ' today, across all outlets'
        }.`}
        action={
          <>
            <ButtonAnchor href={exportHref} download>
              <IconDownload size={15} />
              Export CSV
            </ButtonAnchor>
            <ButtonLink href="/admin/orders/new" variant="primary">
              <IconPlus size={15} />
              New order
            </ButtonLink>
          </>
        }
      />

      <Tabs label="Payment mode" tabs={paymentTabs} />

      <Card className="p-3">
        {/* The tabs own payment; without it, filtering would drop it. */}
        <OrderFilterBar action="/admin/orders" filters={filters} options={options} hidden={{ payment }} />
      </Card>

      <AdminOrdersTable
        orders={orders.map((o) => ({
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
          scheduledArrival: o.scheduledArrival?.toISOString() ?? null,
          amountPaise: o.amountPaise,
          outletName: outletName.get(String(o.restaurantId)) ?? null,
          source: o.source,
          remark: o.remark,
          rider: riderName.get(String(o._id)),
            ...callNoteRow(o),
        }))}
        showOutlet
        showSource
        showRider
        statusOptions={statusOptions}
        emptyNote={
          q && mode !== 'all'
            ? 'Nothing matches in these dates. The search reads the date filter too: try All time.'
            : hasFilters
            ? 'Nothing matches these filters. Try clearing them.'
            : 'Orders arriving by email appear here automatically.'
        }
      />

      {totalCount > 0 ? (
        <Card>
          <Pagination page={page} pageSize={pageSize} total={totalCount} buildHref={paginationHref} />
        </Card>
      ) : null}
    </div>
  )
}
