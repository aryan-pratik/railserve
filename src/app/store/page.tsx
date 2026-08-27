import Link from 'next/link'
import { requireRole } from '@/lib/session'
import { findMany } from '@/lib/repo/orderRepo'
import { todayIST, formatServiceDate } from '@/lib/format'
import { toCardData } from '@/lib/orderView'
import { EmptyState } from '@/components/ui'
import { OrderCard } from '@/components/OrderCard'
import { AutoRefresh } from '@/components/AutoRefresh'
import { AcceptButton, GenerateKotButton, MarkPreparedButton } from './StoreOrderActions'
import type { OrderStatus } from '@/lib/orderStatus'

export const metadata = { title: 'Store · RailServe' }

/** Orders the kitchen is finished with drop off the working view. */
const OPEN_STATUSES: OrderStatus[] = ['RECEIVED', 'ACCEPTED', 'KOT_PRINTED', 'PREPARED']

export default async function StorePage(props: PageProps<'/store'>) {
  const ctx = await requireRole('STORE_MANAGER', 'ADMIN')
  const sp = await props.searchParams
  const tabParam = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab
  const tab = tabParam === 'upcoming' ? 'upcoming' : 'today'

  const today = todayIST()

  // Plan §10: default view is today; bulk booked ahead must not clutter it.
  const orders = await findMany(
    ctx,
    tab === 'today'
      ? { serviceDate: today }
      : { serviceDate: { $gt: today }, status: { $in: OPEN_STATUSES } },
    { sort: tab === 'today' ? { createdAt: 1 } : { serviceDate: 1 }, limit: 200 },
  )

  // Plan §9: cooking is fire-and-forget, sorted by arrival time. No priority
  // queue, no computed cook deadlines.
  const upcomingCount = (
    await findMany(ctx, { serviceDate: { $gt: today }, status: { $in: OPEN_STATUSES } }, { limit: 200 })
  ).length

  const tabs = [
    { key: 'today', label: 'Today', href: '/store', count: orders.length },
    { key: 'upcoming', label: 'Upcoming', href: '/store?tab=upcoming', count: upcomingCount },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            {tab === 'today' ? 'Today' : 'Upcoming'}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {tab === 'today'
              ? formatServiceDate(today)
              : 'Booked ahead — not on today’s pass yet.'}
          </p>
        </div>
        <AutoRefresh seconds={15} />
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
              tab === t.key
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
            <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs tabular-nums text-slate-600">
              {t.count}
            </span>
          </Link>
        ))}
      </div>

      {orders.length === 0 ? (
        <EmptyState
          title={tab === 'today' ? 'Nothing on the pass' : 'Nothing booked ahead'}
          note={
            tab === 'today'
              ? 'New orders appear here automatically within 15 seconds.'
              : 'Bulk orders booked for a future date will show up here.'
          }
        />
      ) : (
        <div className="space-y-4">
          {orders.map((o) => {
            const id = String(o._id)
            return (
              <OrderCard
                key={id}
                order={toCardData(o)}
                href={`/store/orders/${id}`}
                showServiceDate={tab === 'upcoming'}
                actions={
                  <>
                    {o.status === 'RECEIVED' ? <AcceptButton orderId={id} /> : null}
                    {o.status === 'ACCEPTED' ? <GenerateKotButton orderId={id} /> : null}
                    {o.status === 'KOT_PRINTED' ? (
                      <>
                        <GenerateKotButton orderId={id} reprint />
                        <MarkPreparedButton orderId={id} />
                      </>
                    ) : null}
                    {o.status === 'PREPARED' ? (
                      <span className="text-sm font-medium text-emerald-700">
                        On the ready shelf — waiting for dispatch
                      </span>
                    ) : null}
                  </>
                }
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
