import Link from 'next/link'
import { formatRupees, formatServiceDate, formatShortDate, formatTimeIST } from '@/lib/format'
import { CoachChip, Dash, EmptyState, SourceBadge, StatusBadge, TypeBadge, thClass } from './ui'
import { CallNoteHint } from './CallNoteHint'

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
  rawSeat?: Maybe<string>
  contactName?: Maybe<string>
  scheduledArrival?: Maybe<Date>
  amountPaise?: Maybe<number>
  outletName?: Maybe<string>
  /** The aggregator the order arrived from — Order.source. */
  source?: Maybe<string>
  remark?: Maybe<string>
  /** Call-note count and prebuilt tooltip text — see callNoteSummary. */
  callNoteCount?: Maybe<number>
  callNoteHint?: Maybe<string>
}

/**
 * Column widths for the shared order-table shape (Order, Date, Train, Seat,
 * Passenger, [Aggregator], [Outlet], Remark, Amount, Status).
 *
 * Built rather than written out, because the optional columns make four
 * combinations and four hand-tuned lists drift apart the first time one is
 * edited. The weights are relative; they are normalised to percentages that
 * sum to 100, which is what `table-layout: fixed` needs to keep the table
 * inside its container instead of forcing a horizontal scrollbar.
 */
export function OrderTableColGroup({
  showOutlet,
  showSource = false,
}: {
  showOutlet: boolean
  showSource?: boolean
}) {
  const weights = [
    15, // order id
    11, // date
    12, // train
    11, // seat
    15, // passenger
    ...(showSource ? [11] : []), // aggregator
    ...(showOutlet ? [12] : []), // outlet
    14, // remark
    9, // amount
    13, // status
  ]
  const total = weights.reduce((a, b) => a + b, 0)

  return (
    <colgroup>
      {weights.map((w, i) => (
        <col key={i} style={{ width: `${((w / total) * 100).toFixed(3)}%` }} />
      ))}
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
  showSource = false,
  emptyNote = 'Nothing matches these filters.',
}: {
  orders: OrderRow[]
  hrefFor: (id: string) => string
  showOutlet?: boolean
  /** Which aggregator each order came from. Off where every row is the same one. */
  showSource?: boolean
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
      <table className={`w-full table-fixed text-sm ${showSource ? 'min-w-[64rem]' : 'min-w-[56rem]'}`}>
        <OrderTableColGroup showOutlet={showOutlet} showSource={showSource} />
        <thead className="border-b border-line bg-sunken/60">
          <tr>
            <th className={thClass}>Order</th>
            <th className={thClass}>Date</th>
            <th className={thClass}>Train</th>
            <th className={thClass}>Seat</th>
            <th className={thClass}>Passenger</th>
            {showSource ? <th className={thClass}>Aggregator</th> : null}
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
                  {/* The hint rides inside the id's own flex item so it can
                      never be the thing that wraps to a second line, and needs
                      no column of its own: the colgroup percentages above are
                      tuned to sum to 100. */}
                  <span className="flex min-w-0 items-center gap-1">
                    <span className="truncate font-mono text-xs">{o.externalOrderId}</span>
                    <CallNoteHint orderId={o.id} count={o.callNoteCount} hint={o.callNoteHint} />
                  </span>
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
              <td className="px-3 py-2.5"><CoachChip coach={o.coach} berth={o.berth} rawSeat={o.rawSeat} /></td>
              <td className="truncate px-3 py-2.5 text-ink" title={o.contactName ?? undefined}>{o.contactName ?? <Dash />}</td>
              {showSource ? (
                <td className="px-3 py-2.5"><SourceBadge source={o.source} /></td>
              ) : null}
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
