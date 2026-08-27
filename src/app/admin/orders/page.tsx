import Link from 'next/link'
import { requireRole } from '@/lib/session'
import { findMany } from '@/lib/repo/orderRepo'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'
import { ORDER_STATUSES } from '@/lib/orderStatus'
import { formatIST, formatMoney, formatServiceDate, todayIST } from '@/lib/format'
import { Card, EmptyState, StatusBadge, TypeBadge, inputClass } from '@/components/ui'
import type { QueryFilter } from 'mongoose'

export const metadata = { title: 'Orders · RailServe' }

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
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">All orders</h1>
          <p className="mt-1 text-sm text-slate-600">
            {orders.length} order{orders.length === 1 ? '' : 's'}
            {hasFilters ? ' matching your filters' : ' across all outlets'}.
          </p>
        </div>
        <Link
          href="/admin/orders/new"
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          + New order
        </Link>
      </div>

      <Card className="p-4">
        <form className="grid gap-3 sm:grid-cols-5" method="get">
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
              <option key={s} value={s}>{s.replace('_', ' ')}</option>
            ))}
          </select>
          <input type="date" name="date" defaultValue={date} className={inputClass}
            aria-label="Service date" />
          <input name="train" defaultValue={train} placeholder="Train no" className={inputClass}
            aria-label="Train number" />
          <div className="flex gap-2">
            <button type="submit"
              className="flex-1 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">
              Filter
            </button>
            {hasFilters ? (
              <Link href="/admin/orders"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Clear
              </Link>
            ) : null}
          </div>
        </form>
      </Card>

      {orders.length === 0 ? (
        <EmptyState
          title="No orders match"
          note={hasFilters ? 'Try clearing the filters.' : 'Create one with “New order” to exercise the pipeline.'}
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Order</th>
                  <th className="px-4 py-2.5 font-semibold">Outlet</th>
                  <th className="px-4 py-2.5 font-semibold">Train / seat</th>
                  <th className="px-4 py-2.5 font-semibold">Service date</th>
                  <th className="px-4 py-2.5 font-semibold">Amount</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orders.map((o) => (
                  <tr key={String(o._id)} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/admin/orders/${String(o._id)}`}
                        className="font-medium text-slate-900 underline-offset-2 hover:underline">
                        {o.externalOrderId}
                      </Link>
                      <div className="mt-1 flex items-center gap-1.5">
                        <TypeBadge type={o.orderType} />
                        <span className="text-xs text-slate-400">{formatIST(o.createdAt)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {outletName.get(String(o.restaurantId)) ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {o.trainNo ? (
                        <>
                          <div className="font-medium text-slate-900">{o.trainNo}</div>
                          <div className="text-xs">{o.trainName}</div>
                        </>
                      ) : (
                        <span className="text-slate-400">No train</span>
                      )}
                      <div className="text-xs">
                        {o.orderType === 'BULK'
                          ? `${o.pax} pax · ${o.handoverPoint ?? 'handover'}`
                          : o.rawSeat ?? '—'}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatServiceDate(o.serviceDate)}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{formatMoney(o.amountPaise)}</div>
                      <div className="text-xs text-slate-500">{o.paymentMode ?? '—'}</div>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={o.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <p className="text-xs text-slate-400">Today in IST is {formatServiceDate(todayIST())}.</p>
    </div>
  )
}
