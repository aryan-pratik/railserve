import { requireRole } from '@/lib/session'
import { countByPaymentMode, distinctStatuses, findMany } from '@/lib/repo/orderRepo'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'
import { ORDER_STATUSES } from '@/lib/orderStatus'
import { AdminOrdersTable } from './AdminOrdersTable'
import { IconDownload } from '@/components/Icons'
import {
  Button, ButtonAnchor, ButtonLink, Card, Field, PageHeader, Tabs, inputClass, statusLabel,
} from '@/components/ui'
import { DateFilter } from '@/components/DateFilter'
import { resolveDateRange, type DateFilterMode } from '@/lib/dateFilter'
import type { QueryFilter } from 'mongoose'

/**
 * The payment modes an order can carry, in the order they are worth scanning:
 * the two that actually settle money differently come first, and "All" leads
 * because arriving here without a payment question in mind is the common case.
 *
 * Mirrors the PAYMENT_MODES union on the order model — a mode missing here is
 * simply unreachable from the tabs, never a crash.
 */
const PAYMENT_TABS = [
  { value: '', label: 'All' },
  { value: 'COD', label: 'COD' },
  { value: 'PREPAID', label: 'Prepaid' },
  { value: 'INVOICE', label: 'Invoice' },
] as const

export const metadata = { title: 'Orders · RailServe' }

/**
 * Lookup across every outlet.
 *
 * The board is where live work happens; this is where an order is found again
 * once it has left the board — a query, a refund, a reconciliation.
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
  const payment = one(sp.payment)

  await connectDb()
  const outlets = await Restaurant.find({}).select('name stationCode').sort({ name: 1 }).lean()

  // Filters are additive on top of the caller's scope — never instead of it.
  // Payment is layered on last and kept separable, because the tab counts are
  // taken from everything *except* it.
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

  const filter = payment ? { ...base, paymentMode: payment } : base

  // Counted on `base`, so each tab shows what it would return rather than what
  // is on screen — tabs that all read 0 except the one you are standing on are
  // a dead end.
  const [orders, paymentCounts, statusesInUse] = await Promise.all([
    findMany(ctx, filter, { sort: { createdAt: -1 }, limit: 200 }),
    countByPaymentMode(ctx, base),
    distinctStatuses(ctx),
  ])

  // Custom statuses an admin has typed in via adminOverrideStatus, so they
  // stay selectable (for filtering and re-use) once they exist.
  const customStatuses = statusesInUse
    .filter((s) => !(ORDER_STATUSES as readonly string[]).includes(s))
    .sort()
  const statusOptions = [...ORDER_STATUSES, ...customStatuses]

  const outletName = new Map(outlets.map((o) => [String(o._id), `${o.name} · ${o.stationCode}`]))
  const hasFilters = Boolean(outlet || status || dateFrom || dateTo || train || payment)

  // Every link and the export carry the filters already in play, so switching
  // payment mode narrows the current view instead of resetting it.
  const query = (over: Record<string, string>) => {
    const u = new URLSearchParams()
    for (const [k, v] of Object.entries({
      outlet, status, mode, month, from: rawFrom, to: rawTo, train, payment, ...over,
    })) {
      if (v) u.set(k, v)
    }
    return u.toString()
  }

  const paymentTabs = PAYMENT_TABS.map((t) => ({
    href: `/admin/orders${query({ payment: t.value }) ? `?${query({ payment: t.value })}` : ''}`,
    label: t.label,
    count: t.value
      ? (paymentCounts[t.value] ?? 0)
      : Object.values(paymentCounts).reduce((a, b) => a + b, 0),
    active: payment === t.value,
  }))

  const exportHref = `/admin/orders/export?range=all&${query({})}`

  return (
    <div className="space-y-4">
      <PageHeader
        title="All orders"
        note={`${orders.length} order${orders.length === 1 ? '' : 's'}${
          hasFilters ? ' matching your filters' : ' across all outlets'
        }.`}
        action={
          <div className="flex items-center gap-2">
            <ButtonAnchor href={exportHref} download>
              <IconDownload size={15} />
              Export CSV
            </ButtonAnchor>
            <ButtonLink href="/admin/orders/new" variant="primary">+ New order</ButtonLink>
          </div>
        }
      />

      <Tabs tabs={paymentTabs} />

      <Card className="p-3">
        <form className="grid items-end gap-2 sm:grid-cols-6" method="get">
          {/* The tabs own this value; without it, filtering would drop it. */}
          <input type="hidden" name="payment" value={payment} />
          <select name="outlet" defaultValue={outlet} className={inputClass} aria-label="Outlet">
            <option value="">All outlets</option>
            {outlets.map((o) => (
              <option key={String(o._id)} value={String(o._id)}>
                {o.name} — {o.stationCode}
              </option>
            ))}
          </select>
          <select name="status" defaultValue={status} className={inputClass} aria-label="Status">
            <option value="">Any status</option>
            {statusOptions.map((s) => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>
          <input name="train" defaultValue={train} placeholder="Train no"
            className={`${inputClass} font-mono`} aria-label="Train number" />
          <div className="flex gap-2">
            <Button type="submit" variant="secondary" className="flex-1">Filter</Button>
            {hasFilters ? <ButtonLink href="/admin/orders" variant="ghost">Clear</ButtonLink> : null}
          </div>
          <div className="sm:col-span-6">
            <Field label="Date">
              <DateFilter mode={mode} month={month} from={rawFrom} to={rawTo} allowAll />
            </Field>
          </div>
        </form>
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
    </div>
  )
}
