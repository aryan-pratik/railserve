import Link from 'next/link'
import type { QueryFilter } from 'mongoose'
import { requireRole } from '@/lib/session'
import { countOrders, findMany } from '@/lib/repo/orderRepo'
import { LIVE_STATUSES } from '@/lib/repo/runRepo'
import { formatServiceDate, formatShortDate, formatTimeIST, todayIST } from '@/lib/format'
import { callNoteSummary } from '@/lib/orderView'
import { TableFrame } from '@/components/OrdersTable'
import { CallNoteHint } from '@/components/CallNoteHint'
import { QueryForm } from '@/components/QueryForm'
import { IconPhone, IconSearch } from '@/components/Icons'
import {
  Button, Card, CoachChip, Dash, EmptyState, Field, PageHeader, StatusBadge, Tabs,
  inputClass, thClass,
} from '@/components/ui'

export const metadata = { title: 'Call list · RailServe' }

/** Escapes regex metacharacters so a typed order id is matched literally. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const ROW_LIMIT = 200

/**
 * The telecaller's call list.
 *
 * Deliberately not the kitchen board. A telecaller works down a list of
 * passengers to ring, so this is one flat row per order with the phone number
 * on it — not cards grouped by train, which is the kitchen's way of seeing the
 * same orders and answers a different question ("what do I cook next").
 *
 * There is no money on this screen and no way to reach any. That is not a
 * matter of what is rendered: `latestBalance` and `setPaymentRemark` both
 * refuse a TELECALLER outright, and the scoped repository refuses any order
 * outside the outlets this telecaller holds. Leaving the columns off is just
 * the half of it a person can see.
 */
export default async function CallsPage(props: PageProps<'/calls'>) {
  const ctx = await requireRole('TELECALLER')
  const sp = await props.searchParams

  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''
  const tab = one(sp.tab)
  const q = one(sp.q).trim()

  const today = todayIST()
  const showUpcoming = tab === 'upcoming'
  const showCancelled = tab === 'cancelled'
  const showAll = tab === 'all'

  // Filters are additive on top of the caller's scope, never instead of it —
  // "all" means every date and every status within the outlets this telecaller
  // holds, not every order in the system.
  const base: QueryFilter<Record<string, unknown>> = showAll
    ? {}
    : showCancelled
      ? { serviceDate: today, status: 'CANCELLED' }
      : showUpcoming
        ? { serviceDate: { $gt: today }, status: { $in: LIVE_STATUSES } }
        : { serviceDate: today, status: { $in: LIVE_STATUSES } }

  // One box, four fields: a telecaller has whatever the passenger just read
  // out to them, and should not have to know which column it lives in.
  if (q) {
    const rx = { $regex: escapeRegExp(q), $options: 'i' }
    base.$or = [
      { externalOrderId: rx },
      { contactPhone: rx },
      { contactName: rx },
      { trainNo: rx },
    ]
  }

  const counts: QueryFilter<Record<string, unknown>>[] = [
    { serviceDate: today, status: { $in: LIVE_STATUSES } },
    { serviceDate: { $gt: today }, status: { $in: LIVE_STATUSES } },
    { serviceDate: today, status: 'CANCELLED' },
  ]

  const [orders, todayCount, upcomingCount, cancelledCount] = await Promise.all([
    findMany(ctx, base, {
      sort: showAll
        ? { serviceDate: -1, createdAt: -1 }
        : showCancelled
          ? { updatedAt: -1 }
          : { serviceDate: 1, scheduledArrival: 1, createdAt: 1 },
      limit: ROW_LIMIT,
    }),
    countOrders(ctx, counts[0]),
    countOrders(ctx, counts[1]),
    countOrders(ctx, counts[2]),
  ])

  const href = (t: string) => {
    const u = new URLSearchParams()
    if (t) u.set('tab', t)
    if (q) u.set('q', q)
    const s = u.toString()
    return s ? `/calls?${s}` : '/calls'
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Call list"
        note={
          showUpcoming
            ? 'Orders booked for a later date.'
            : showCancelled
              ? `Cancelled today · ${formatServiceDate(today)}`
              : showAll
                ? 'Every order at your outlets, whatever the date.'
                : formatServiceDate(today)
        }
      />

      <Tabs
        label="Call list"
        tabs={[
          { href: href(''), label: 'Today', count: todayCount, active: !showUpcoming && !showCancelled && !showAll },
          { href: href('upcoming'), label: 'Upcoming', count: upcomingCount, active: showUpcoming },
          { href: href('cancelled'), label: 'Cancelled today', count: cancelledCount, active: showCancelled },
          { href: href('all'), label: 'All orders', active: showAll },
        ]}
      />

      <Card>
        <QueryForm action="/calls" className="flex flex-wrap items-end gap-3 p-3">
          {tab ? <input type="hidden" name="tab" value={tab} /> : null}
          <div className="min-w-[14rem] flex-1">
            <Field label="Find a passenger" htmlFor="q">
              <input
                id="q"
                name="q"
                defaultValue={q}
                placeholder="Order id, phone, name or train number"
                className={inputClass}
              />
            </Field>
          </div>
          <Button type="submit" variant="secondary">
            <IconSearch size={15} />
            Search
          </Button>
          {q ? (
            <Link
              href={tab ? `/calls?tab=${tab}` : '/calls'}
              className="pb-2 text-sm font-medium text-muted underline-offset-2 hover:underline"
            >
              Clear
            </Link>
          ) : null}
        </QueryForm>
      </Card>

      {orders.length === 0 ? (
        <EmptyState
          title={
            q
              ? 'Nothing matches that'
              : showCancelled
                ? 'Nothing cancelled today'
                : showAll
                  ? 'No orders yet'
                  : 'No orders to call'
          }
          note={
            q
              ? 'Try the order id on its own, or just the last few digits of the phone number.'
              : showCancelled
                ? 'Orders you cancel today appear here, so you can check what you have already done.'
                : showAll
                  ? 'Search by order id, phone or name to find one from any date.'
                  : 'Orders appear here as they arrive at the outlets you cover.'
          }
        />
      ) : (
        <TableFrame>
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="border-b border-line bg-sunken/60">
              <tr>
                <th className={thClass}>Order</th>
                <th className={thClass}>Train</th>
                <th className={thClass}>Seat</th>
                <th className={thClass}>Passenger</th>
                <th className={thClass}>Phone</th>
                <th className={thClass}>Arrives</th>
                <th className={thClass}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {orders.map((o) => {
                const id = String(o._id)
                return (
                  <tr key={id} className="hover:bg-sunken/50">
                    <td className="px-3 py-2.5">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <Link
                          href={`/calls/orders/${id}`}
                          className="font-mono font-semibold text-accent underline-offset-2 hover:underline"
                        >
                          {o.externalOrderId}
                        </Link>
                        <CallNoteHint orderId={id} {...callNoteSummary(o.callLog)} />
                      </span>
                      {showUpcoming || showAll ? (
                        <div className="text-xs text-faint">{formatShortDate(o.serviceDate)}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5">
                      {o.trainNo ? (
                        <>
                          <span className="font-mono font-semibold tabular-nums text-ink">{o.trainNo}</span>
                          <div className="truncate text-xs text-faint">{o.trainName}</div>
                        </>
                      ) : (
                        <Dash />
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <CoachChip coach={o.coach} berth={o.berth} rawSeat={o.rawSeat} />
                    </td>
                    <td className="px-3 py-2.5 text-muted">{o.contactName || <Dash />}</td>
                    <td className="px-3 py-2.5">
                      {o.contactPhone ? (
                        <a
                          href={`tel:${o.contactPhone}`}
                          className="inline-flex items-center gap-1.5 font-mono font-medium tabular-nums text-accent underline-offset-2 hover:underline"
                        >
                          <IconPhone size={13} aria-hidden />
                          {o.contactPhone}
                        </a>
                      ) : (
                        <span className="text-xs text-faint">No number</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-muted">
                      {o.scheduledArrival ? formatTimeIST(o.scheduledArrival) : <Dash />}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={o.status} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </TableFrame>
      )}

      {orders.length === ROW_LIMIT ? (
        <p className="text-xs text-faint">
          Showing the first {ROW_LIMIT}. Narrow it with the search box above.
        </p>
      ) : null}
    </div>
  )
}
