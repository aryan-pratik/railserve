import { connectDb } from '../db'
import { Order } from '../models'
import { RETIRED_STATUSES, TERMINAL_STATUSES, type OrderStatus } from '../orderStatus'

/**
 * Converts orders still in a status the 2026-11 clean-up retired (see
 * RETIRED_STATUSES in lib/orderStatus.ts) into the status that says what
 * really happened, keeping the rest as a reason, a refund or a tag:
 *
 *   MISDELIVERY                       -> FAILED, reason WRONG_PASSENGER
 *   MISSED_DELIVERY (and the typo)    -> FAILED, reason MISSED_TRAIN
 *   REFUNDED (and REFUND)             -> the status before it, + order.refund
 *   RATING_ORDER                      -> the status before it, + ratingOrder
 *
 * "The status before it" comes from the order's own event log. If that was
 * still in progress (a refund or a decoy flag ended the order early), the
 * order is closed as CANCELLED, or LOST for a group enquiry, so it never
 * reappears on a kitchen screen.
 *
 * Runs at every boot (src/instrumentation.ts) and touches only orders still
 * in a retired status, so after the first run it is a no-op. The event log is
 * not rewritten: it is history, and one event is added saying what changed.
 * Platform-wide on purpose (allTenants): every company's orders.
 */

type Event = { fromStatus?: string | null; toStatus: string; createdAt?: Date }

const CLOSED = new Set<string>(TERMINAL_STATUSES)
const RETIRED = new Set<string>(RETIRED_STATUSES)

/** The last real status before the order entered a retired one. */
function statusBefore(events: Event[], current: string): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.toStatus === current || RETIRED.has(e.toStatus)) {
      const from = e.fromStatus ?? null
      if (from && !RETIRED.has(from)) return from
    }
  }
  return null
}

/** A closed status for an order whose real status was still in progress. */
function closedFrom(before: string | null): OrderStatus {
  if (before && CLOSED.has(before)) return before as OrderStatus
  if (before === 'ENQUIRY' || before === 'QUOTED') return 'LOST'
  if (before === 'PREPARED' || before === 'DISPATCHED') return 'FAILED'
  return 'CANCELLED'
}

export type StatusCleanupReport = { converted: Record<string, number>; failed: number }

export async function cleanUpRetiredStatuses(log: (line: string) => void = () => {}): Promise<StatusCleanupReport> {
  await connectDb()
  const report: StatusCleanupReport = { converted: {}, failed: 0 }
  const rows = await Order.find({ status: { $in: [...RETIRED_STATUSES] } })
    .select('_id tenantId status events amountPaise delivery.failureReason delivery.closedAt refund')
    .setOptions({ allTenants: true })
    .lean()

  for (const o of rows) {
    const from = o.status
    const events = (o.events ?? []) as Event[]
    const enteredAt = [...events].reverse().find((e) => e.toStatus === from)?.createdAt ?? new Date()
    const $set: Record<string, unknown> = {}
    let to: OrderStatus

    if (from === 'MISDELIVERY') {
      to = 'FAILED'
      if (!o.delivery?.failureReason) $set['delivery.failureReason'] = 'WRONG_PASSENGER'
    } else if (from === 'MISSED_DELIVERY' || from === 'MISSED_DELEVERY') {
      to = 'FAILED'
      if (!o.delivery?.failureReason) $set['delivery.failureReason'] = 'MISSED_TRAIN'
    } else if (from === 'REFUNDED' || from === 'REFUND') {
      to = closedFrom(statusBefore(events, from))
      if (!o.refund) {
        $set.refund = {
          amountPaise: o.amountPaise ?? 0,
          reason: to === 'CANCELLED' || to === 'LOST' ? 'CANCELLED' : to === 'FAILED' ? 'NOT_DELIVERED' : 'OTHER',
          payer: null,
          note: 'Marked refunded before refunds had amounts; the full order amount is assumed.',
          at: enteredAt,
          byId: null,
        }
      }
    } else {
      // RATING_ORDER
      to = closedFrom(statusBefore(events, from))
      $set.ratingOrder = true
    }
    $set.status = to
    if (!o.delivery?.closedAt) $set['delivery.closedAt'] = enteredAt

    try {
      await Order.updateOne(
        { _id: o._id, tenantId: o.tenantId, status: from },
        { $set, $push: { events: { fromStatus: from, toStatus: to, userId: null, meta: { via: 'status-cleanup' }, createdAt: new Date() } } },
      ).setOptions({ allTenants: true })
      report.converted[`${from} -> ${to}`] = (report.converted[`${from} -> ${to}`] ?? 0) + 1
    } catch (err) {
      // One odd order must not stop the server from starting.
      report.failed++
      log(`order ${String(o._id)} (${from}) not converted: ${(err as Error).message}`)
    }
  }

  for (const [k, n] of Object.entries(report.converted)) log(`${k}: ${n} order(s)`)
  return report
}
