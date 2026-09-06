import Link from 'next/link'
import { formatRupees, formatServiceDate, formatShortDate, formatTimeIST } from '@/lib/format'
import { CoachChip, Dash, EmptyState, StatusBadge, TypeBadge, thClass } from './ui'

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
  remark?: Maybe<string>
}

/**
 * Column widths for the shared order-table shape (Order, Date, Train, Seat,
 * Passenger, [Outlet], Remark, Amount, Status), as percentages summing to
 * 100 so the table (table-layout: fixed) never grows past its container:
 * cells wrap or truncate instead of forcing a horizontal scrollbar.
 */
export function OrderTableColGroup({ showOutlet }: { showOutlet: boolean }) {
  return showOutlet ? (
    <colgroup>
      <col style={{ width: '13%' }} />
      <col style={{ width: '10%' }} />
      <col style={{ width: '11%' }} />
      <col style={{ width: '10%' }} />
      <col style={{ width: '13%' }} />
      <col style={{ width: '11%' }} />
      <col style={{ width: '12%' }} />
      <col style={{ width: '8%' }} />
      <col style={{ width: '12%' }} />
    </colgroup>
  ) : (
    <colgroup>
      <col style={{ width: '15%' }} />
      <col style={{ width: '11%' }} />
      <col style={{ width: '12%' }} />
      <col style={{ width: '11%' }} />
      <col style={{ width: '15%' }} />
      <col style={{ width: '14%' }} />
      <col style={{ width: '9%' }} />
      <col style={{ width: '13%' }} />
    </colgroup>
  )
}

/** The wrapper every data table sits in. Scrolls sideways on a phone; the page never does. */
export function TableFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
      {children}
    </div>
  )
}

/** Flat list for lookup and history. The board is where live work happens. */
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
    <TableFrame>
      {/* The min-width gives the scroll wrapper something coherent to scroll:
          without it the percentages resolve against a 375px phone and the
          seat and amount columns collapse to nothing. */}
      <table className="w-full min-w-[56rem] table-fixed text-sm">
        <OrderTableColGroup showOutlet={showOutlet} />
        <thead className="border-b border-line bg-sunken/60">
          <tr>
            <th className={thClass}>Order</th>
            <th className={thClass}>Date</th>
            <th className={thClass}>Train</th>
            <th className={thClass}>Seat</th>
            <th className={thClass}>Passenger</th>
            {showOutlet ? <th className={thClass}>Outlet</th> : null}
            <th className={thClass}>Remark</th>
            <th className={`${thClass} text-right`}>Amount</th>
            <th className={thClass}>Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {orders.map((o) => (
            <tr key={o.id} className="transition-colors hover:bg-sunken/60">
              <td className="px-3 py-2.5">
                <Link href={hrefFor(o.id)} className="flex min-w-0 items-center gap-1.5 font-medium text-accent hover:underline">
                  <span className="truncate font-mono text-xs">{o.externalOrderId}</span>
                  <TypeBadge type={o.orderType} />
                </Link>
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-muted" title={formatServiceDate(o.serviceDate)}>
                {formatShortDate(o.serviceDate)}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5">
                <span className="font-mono tabular-nums text-ink">{o.trainNo ?? <Dash />}</span>
                {o.scheduledArrival ? (
                  <span className="ml-1.5 text-xs tabular-nums text-muted">{formatTimeIST(o.scheduledArrival)}</span>
                ) : null}
              </td>
              <td className="px-3 py-2.5"><CoachChip coach={o.coach} berth={o.berth} /></td>
              <td className="truncate px-3 py-2.5 text-ink" title={o.contactName ?? undefined}>{o.contactName ?? <Dash />}</td>
              {showOutlet ? <td className="truncate px-3 py-2.5 text-muted" title={o.outletName ?? undefined}>{o.outletName ?? <Dash />}</td> : null}
              <td className="truncate px-3 py-2.5 text-amber-800" title={o.remark ?? undefined}>
                {o.remark ?? <Dash />}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-ink">{formatRupees(o.amountPaise)}</td>
              <td className="px-3 py-2.5"><StatusBadge status={o.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
  )
}
