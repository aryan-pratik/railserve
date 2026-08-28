import { requireRole } from '@/lib/session'
import { findMany } from '@/lib/repo/orderRepo'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'
import { ORDER_STATUSES } from '@/lib/orderStatus'
import { OrdersTable } from '@/components/OrdersTable'
import {
  Button, ButtonLink, Card, PageHeader, inputClass, statusLabel,
} from '@/components/ui'
import type { QueryFilter } from 'mongoose'

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
  const date = one(sp.date)
  const train = one(sp.train)

  await connectDb()
  const outlets = await Restaurant.find({}).select('name stationCode').sort({ name: 1 }).lean()

  // Filters are additive on top of the caller's scope — never instead of it.
  const filter: QueryFilter<Record<string, unknown>> = {}
  if (outlet) filter.restaurantId = outlet
  if (status) filter.status = status
  if (date) filter.serviceDate = date
  if (train) filter.trainNo = train.toUpperCase()

  const orders = await findMany(ctx, filter, { sort: { createdAt: -1 }, limit: 200 })
  const outletName = new Map(outlets.map((o) => [String(o._id), `${o.name} · ${o.stationCode}`]))
  const hasFilters = Boolean(outlet || status || date || train)

  return (
    <div className="space-y-4">
      <PageHeader
        title="All orders"
        note={`${orders.length} order${orders.length === 1 ? '' : 's'}${
          hasFilters ? ' matching your filters' : ' across all outlets'
        }.`}
        action={<ButtonLink href="/admin/orders/new" variant="primary">+ New order</ButtonLink>}
      />

      <Card className="p-3">
        <form className="grid gap-2 sm:grid-cols-5" method="get">
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
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>
          <input type="date" name="date" defaultValue={date} className={inputClass}
            aria-label="Service date" />
          <input name="train" defaultValue={train} placeholder="Train no"
            className={`${inputClass} font-mono`} aria-label="Train number" />
          <div className="flex gap-2">
            <Button type="submit" variant="secondary" className="flex-1">Filter</Button>
            {hasFilters ? <ButtonLink href="/admin/orders" variant="ghost">Clear</ButtonLink> : null}
          </div>
        </form>
      </Card>

      <OrdersTable
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
          scheduledArrival: o.scheduledArrival,
          amountPaise: o.amountPaise,
          outletName: outletName.get(String(o.restaurantId)) ?? null,
        }))}
        hrefFor={(id) => `/admin/orders/${id}`}
        showOutlet
        emptyNote={
          hasFilters
            ? 'Nothing matches these filters. Try clearing them.'
            : 'Orders arriving by email appear here automatically.'
        }
      />
    </div>
  )
}
