import Link from 'next/link'
import { formatRupees, formatTimeIST, formatServiceDate } from '@/lib/format'
import { CoachChip, EmptyState, StatusBadge, TypeBadge } from './ui'

type Maybe<T> = T | null | undefined

export type OrderRow = {
  id: string
  externalOrderId: string
  orderType: string
  status: string
  serviceDate: string
  trainNo?: Maybe<string>
  coach?: Maybe<string>
  berth?: Maybe<string>
  contactName?: Maybe<string>
  scheduledArrival?: Maybe<Date>
  amountPaise?: Maybe<number>
  outletName?: Maybe<string>
}

const TH = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted'

/** Flat list for lookup and history — the board is where live work happens. */
export function OrdersTable({
  orders,
  hrefFor,
  showOutlet = false,
  emptyNote = 'Nothing matches these filters.',
}: {
  orders: OrderRow[]
  hrefFor: (id: string) => string
  showOutlet?: boolean
  emptyNote?: string
}) {
  if (orders.length === 0) {
    return <EmptyState title="No orders" note={emptyNote} />
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
      <table className="w-full text-sm">
        <thead className="border-b border-line bg-sunken/60">
          <tr>
            <th className={TH}>Order</th>
            <th className={TH}>Date</th>
            <th className={TH}>Train</th>
            <th className={TH}>Seat</th>
            <th className={TH}>Passenger</th>
            {showOutlet ? <th className={TH}>Outlet</th> : null}
            <th className={`${TH} text-right`}>Amount</th>
            <th className={TH}>Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {orders.map((o) => (
            <tr key={o.id} className="transition hover:bg-sunken/60">
              <td className="px-3 py-2.5">
                <Link href={hrefFor(o.id)} className="flex items-center gap-1.5 font-medium text-accent hover:underline">
                  <span className="font-mono text-xs">{o.externalOrderId}</span>
                  <TypeBadge type={o.orderType} />
                </Link>
              </td>
              <td className="px-3 py-2.5 whitespace-nowrap text-muted">
                {formatServiceDate(o.serviceDate)}
              </td>
              <td className="px-3 py-2.5 whitespace-nowrap">
                <span className="font-mono tabular-nums text-ink">{o.trainNo ?? '—'}</span>
                {o.scheduledArrival ? (
                  <span className="ml-1.5 tabular-nums text-xs text-muted">
                    {formatTimeIST(o.scheduledArrival)}
                  </span>
                ) : null}
              </td>
              <td className="px-3 py-2.5"><CoachChip coach={o.coach} berth={o.berth} /></td>
              <td className="px-3 py-2.5 text-ink">{o.contactName ?? '—'}</td>
              {showOutlet ? <td className="px-3 py-2.5 text-muted">{o.outletName ?? '—'}</td> : null}
              <td className="px-3 py-2.5 text-right tabular-nums text-ink">
                {formatRupees(o.amountPaise)}
              </td>
              <td className="px-3 py-2.5"><StatusBadge status={o.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
