import { requireRole } from '@/lib/session'
import { dailyCounts, outletAnalytics } from '@/lib/repo/orderRepo'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'
import { formatMoney, formatServiceDate, shiftServiceDate, todayIST } from '@/lib/format'
import { Card, CardHeader, EmptyState, inputClass } from '@/components/ui'

export const metadata = { title: 'Analytics · RailServe' }

function pct(n: number, d: number): string {
  if (d === 0) return '—'
  return `${Math.round((n / d) * 100)}%`
}

export default async function AnalyticsPage(props: PageProps<'/admin/analytics'>) {
  const ctx = await requireRole('ADMIN')
  const sp = await props.searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

  const to = one(sp.to) || todayIST()
  const from = one(sp.from) || shiftServiceDate(to, -29)

  const [stats, daily, outlets] = await Promise.all([
    outletAnalytics(ctx, { from, to }),
    dailyCounts(ctx, { from, to }),
    connectDb().then(() => Restaurant.find({}).select('name stationCode').lean()),
  ])

  const name = new Map(outlets.map((o) => [String(o._id), `${o.name} · ${o.stationCode}`]))

  const totals = stats.reduce(
    (a, s) => ({
      orders: a.orders + s.orders,
      delivered: a.delivered + s.delivered,
      failed: a.failed + s.failed,
      revenuePaise: a.revenuePaise + s.revenuePaise,
    }),
    { orders: 0, delivered: 0, failed: 0, revenuePaise: 0 },
  )

  const peak = Math.max(1, ...daily.map((d) => d.orders))

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Analytics</h1>
          <p className="mt-1 text-sm text-slate-600">
            {formatServiceDate(from)} — {formatServiceDate(to)}
          </p>
        </div>
        <form method="get" className="flex items-end gap-2">
          <div>
            <label htmlFor="from" className="mb-1 block text-xs font-medium text-slate-600">From</label>
            <input id="from" name="from" type="date" defaultValue={from} className={inputClass} />
          </div>
          <div>
            <label htmlFor="to" className="mb-1 block text-xs font-medium text-slate-600">To</label>
            <input id="to" name="to" type="date" defaultValue={to} className={inputClass} />
          </div>
          <button type="submit"
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">
            Show
          </button>
        </form>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: 'Orders', value: String(totals.orders) },
          { label: 'Delivered', value: `${totals.delivered} (${pct(totals.delivered, totals.orders)})` },
          { label: 'Failed', value: `${totals.failed} (${pct(totals.failed, totals.orders)})` },
          { label: 'Delivered value', value: formatMoney(totals.revenuePaise) },
        ].map((k) => (
          <Card key={k.label} className="p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{k.label}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{k.value}</div>
          </Card>
        ))}
      </div>

      {stats.length === 0 ? (
        <EmptyState title="No orders in this range" note="Widen the dates, or create some orders." />
      ) : (
        <>
          <Card className="overflow-hidden">
            <CardHeader title="By outlet" />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Outlet</th>
                    <th className="px-4 py-2.5 font-semibold">Orders</th>
                    <th className="px-4 py-2.5 font-semibold">Delivered</th>
                    <th className="px-4 py-2.5 font-semibold">Success</th>
                    <th className="px-4 py-2.5 font-semibold">Avg received → delivered</th>
                    <th className="px-4 py-2.5 font-semibold">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stats.map((s) => (
                    <tr key={s.restaurantId ?? 'none'}>
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {s.restaurantId ? (name.get(s.restaurantId) ?? '—') : 'Unassigned'}
                      </td>
                      <td className="px-4 py-3 tabular-nums">{s.orders}</td>
                      <td className="px-4 py-3 tabular-nums">{s.delivered}</td>
                      <td className="px-4 py-3 tabular-nums">{pct(s.delivered, s.orders)}</td>
                      <td className="px-4 py-3 tabular-nums">
                        {s.avgReceivedToDeliveredMinutes !== null
                          ? `${s.avgReceivedToDeliveredMinutes} min`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 tabular-nums">{formatMoney(s.revenuePaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardHeader title="Orders per day" />
            <div className="flex items-end gap-1 overflow-x-auto p-4" style={{ minHeight: 140 }}>
              {daily.map((d) => (
                <div key={d.serviceDate} className="flex min-w-[26px] flex-col items-center gap-1">
                  <div className="flex w-full flex-col justify-end" style={{ height: 100 }}>
                    <div
                      className="w-full rounded-t bg-slate-300"
                      style={{ height: `${((d.orders - d.delivered) / peak) * 100}%` }}
                      title={`${d.orders - d.delivered} not delivered`}
                    />
                    <div
                      className="w-full rounded-b bg-emerald-500"
                      style={{ height: `${(d.delivered / peak) * 100}%` }}
                      title={`${d.delivered} delivered`}
                    />
                  </div>
                  <span className="text-[10px] tabular-nums text-slate-400">
                    {d.serviceDate.slice(8)}
                  </span>
                </div>
              ))}
            </div>
            <p className="px-4 pb-3 text-xs text-slate-500">
              Green is delivered, grey is everything else. Day of month along the bottom.
            </p>
          </Card>
        </>
      )}
    </div>
  )
}
