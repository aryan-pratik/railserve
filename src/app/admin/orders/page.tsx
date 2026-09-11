import { requireRole } from '@/lib/session'
import { countByPaymentMode, countOrders, distinctStatuses, findMany } from '@/lib/repo/orderRepo'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'
import { ORDER_STATUSES } from '@/lib/orderStatus'
import { AdminOrdersTable } from './AdminOrdersTable'
import { IconDownload, IconPlus } from '@/components/Icons'
import {
  Button, ButtonAnchor, ButtonLink, Card, Field, PageHeader, Pagination, Tabs,
  PAGE_SIZE_OPTIONS, inputClass, statusLabel,
} from '@/components/ui'
import { DateFilter } from '@/components/DateFilter'
import { QueryForm } from '@/components/QueryForm'
import { resolveDateRange, type DateFilterMode } from '@/lib/dateFilter'
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

/** Escapes regex metacharacters so a typed order id is matched literally. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

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
  const outlet = one(sp.outlet)
  const status = one(sp.status)
  const mode = (one(sp.mode) || 'all') as DateFilterMode
  const month = one(sp.month)
  const rawFrom = one(sp.from)
  const rawTo = one(sp.to)
  const { from: dateFrom, to: dateTo } = resolveDateRange(mode, { month, from: rawFrom, to: rawTo })
  const train = one(sp.train)
  const orderId = one(sp.orderId)
  const payment = one(sp.payment)

  const pageParam = Number.parseInt(one(sp.page), 10)
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1
  const pageSizeParam = Number.parseInt(one(sp.pageSize), 10)
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(pageSizeParam)
    ? pageSizeParam
    : DEFAULT_PAGE_SIZE

  // Filters are additive on top of the caller's scope, never instead of it.
  // Payment is layered on last and kept separable, because the tab counts are
  // taken from everything except it.
  const base: QueryFilter<Record<string, unknown>> = {}
  if (outlet) base.restaurantId = outlet
  if (status) base.status = status
  if (dateFrom || dateTo) {
    const range: Record<string, string> = {}
    if (dateFrom) range.$gte = dateFrom
    if (dateTo) range.$lte = dateTo
    base.serviceDate = range
  }
  if (train) base.trainNo = train.toUpperCase()
  if (orderId) base.externalOrderId = { $regex: escapeRegExp(orderId), $options: 'i' }

  const filter = payment ? { ...base, paymentMode: payment } : base

  await connectDb()
  const [outlets, orders, paymentCounts, statusesInUse, totalCount] = await Promise.all([
    Restaurant.find({}).select('name stationCode').sort({ name: 1 }).lean(),
    findMany(ctx, filter, { sort: { createdAt: -1 }, limit: pageSize, skip: (page - 1) * pageSize }),
    countByPaymentMode(ctx, base),
    distinctStatuses(ctx),
    countOrders(ctx, filter),
  ])

  // Custom statuses an admin has typed in stay selectable once they exist.
  const customStatuses = statusesInUse
    .filter((s) => !(ORDER_STATUSES as readonly string[]).includes(s))
    .sort()
  const statusOptions = [...ORDER_STATUSES, ...customStatuses]

  const outletName = new Map(outlets.map((o) => [String(o._id), `${o.name} · ${o.stationCode}`]))
  const hasFilters = Boolean(outlet || status || dateFrom || dateTo || train || orderId || payment)

  // Every link and the export carry the filters already in play.
  const query = (over: Record<string, string>) => {
    const u = new URLSearchParams()
    for (const [k, v] of Object.entries({
      outlet, status, mode, month, from: rawFrom, to: rawTo, train, orderId, payment, ...over,
    })) {
      if (v) u.set(k, v)
    }
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

  const exportHref = `/admin/orders/export?range=all&${query({})}`

  // Separate from `query()`: a filter change should always land back on page
  // 1, but the pager itself needs to carry the current page/size forward.
  const paginationHref = ({ page: p, pageSize: ps }: { page: number; pageSize: number }) => {
    const u = new URLSearchParams()
    for (const [k, v] of Object.entries({
      outlet, status, mode, month, from: rawFrom, to: rawTo, train, orderId, payment,
    })) {
      if (v) u.set(k, v)
    }
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
          hasFilters ? ' matching these filters' : ' across all outlets'
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
        <QueryForm action="/admin/orders" className="grid items-end gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {/* The tabs own this value; without it, filtering would drop it. */}
          <input type="hidden" name="payment" value={payment} />
          <select name="outlet" defaultValue={outlet} className={inputClass} aria-label="Outlet">
            <option value="">All outlets</option>
            {outlets.map((o) => (
              <option key={String(o._id)} value={String(o._id)}>
                {o.name} · {o.stationCode}
              </option>
            ))}
          </select>
          <select name="status" defaultValue={status} className={inputClass} aria-label="Status">
            <option value="">Any status</option>
            {statusOptions.map((s) => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>
          <input name="train" defaultValue={train} placeholder="Train number" inputMode="numeric"
            autoComplete="off" spellCheck={false}
            className={`${inputClass} font-mono`} aria-label="Train number" />
          <input name="orderId" defaultValue={orderId} placeholder="Order ID"
            autoComplete="off" spellCheck={false}
            className={`${inputClass} font-mono`} aria-label="Order ID" />
          <div className="flex gap-2">
            <Button type="submit" variant="secondary" className="flex-1">Apply</Button>
            {hasFilters ? <ButtonLink href="/admin/orders" variant="ghost">Clear</ButtonLink> : null}
          </div>
          <div className="sm:col-span-2 lg:col-span-5">
            <Field label="Date">
              <DateFilter mode={mode} month={month} from={rawFrom} to={rawTo} allowAll />
            </Field>
          </div>
        </QueryForm>
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
          remark: o.remark,
        }))}
        showOutlet
        statusOptions={statusOptions}
        emptyNote={
          hasFilters
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
