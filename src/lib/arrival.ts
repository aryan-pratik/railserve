import { ORDER_STATUSES, TERMINAL_STATUSES } from './orderStatus'
import type { TimingView } from './train/policy'

/** Under this, a time that moved from the booking is rounding noise, not news. */
export const MOVED_AFTER_MINUTES = 5

/**
 * What an order record should say about arrival, decided in one place.
 *
 * "Arrival" is not one value. It changes over the order's life and comes from
 * three sources that last different lengths of time:
 *
 *   booked     order.scheduledArrival          permanent   the aggregator's
 *                                                          claim, unverified
 *   expected   TrainStatus cache (TimingView)  ~7 days,    an estimate that
 *                                              refreshed   moves
 *                                              only while
 *                                              the order is open
 *   delivered  order.delivery.deliveredAt      permanent   a recorded fact
 *
 * A record page must never show the middle one once it has stopped being
 * true. When an order closes the cron stops refreshing its train, and seven
 * days later the reading is pruned outright, so reading the cache for a closed
 * order yields either a frozen guess or, after the prune, the booked time
 * shown as though it had happened. Hence one rule per phase:
 *
 *   open, train has arrived    arrived     fact      (railway confirmed)
 *   open, fresh live reading   expected    estimate
 *   open, no or stale reading  booked      unverified
 *   delivered                  delivered   fact
 *   closed any other way       booked      context (cancelled, failed, lost,
 *                                          or an admin's custom status)
 *
 * Deviation is always measured against the booking, never against the
 * railway's own "on time": an aggregator's stated arrival can be hours out
 * from the railway's timetable while the train itself runs to schedule, and
 * that silent move is exactly the change a record needs to show.
 *
 * Pure and dependency-free so the call list, the live board and any future
 * screen can share it and never disagree about one order.
 */
export type ArrivalKind = 'expected' | 'arrived' | 'booked' | 'delivered'
export type ArrivalCertainty = 'fact' | 'estimate' | 'unverified' | 'context'

export type ArrivalRecord = {
  kind: ArrivalKind
  /** The time to show. Null only when the order carries no time at all. */
  time: Date | null
  certainty: ArrivalCertainty
  /** The time the order was booked against. */
  booked: Date | null
  /** Signed minutes from the booking; null when there is nothing to compare. */
  minutesVsBooked: number | null
  /** Set only when the move is past MOVED_AFTER_MINUTES. */
  direction: 'later' | 'earlier' | null
  /** Age of the live reading, when the time came from one. */
  checkedMinutesAgo: number | null
  /** An ETA already in the past that the railway has not confirmed yet. */
  pastDue: boolean
}

type ArrivalOrder = {
  status: string
  scheduledArrival?: Date | null
  delivery?: { deliveredAt?: Date | null } | null
}

const OPEN = new Set<string>(
  ORDER_STATUSES.filter((s) => !(TERMINAL_STATUSES as readonly string[]).includes(s)),
)

/**
 * `now` is a parameter, not read inside, so this stays pure: callers pass one
 * clock for the whole page, and tests can pin the moment a train goes by.
 */
export function arrivalRecord(
  order: ArrivalOrder,
  timing: TimingView | null,
  now: Date = new Date(),
): ArrivalRecord {
  const booked = order.scheduledArrival ?? null
  const deliveredAt = order.delivery?.deliveredAt ?? null

  if (order.status === 'DELIVERED' && deliveredAt) {
    return withDeviation({ kind: 'delivered', time: deliveredAt, certainty: 'fact', booked, checkedMinutesAgo: null, pastDue: false })
  }

  // Anything not on the open path, including a custom status an admin typed
  // in, is a closed record: the booked time is context, and nothing live is
  // worth showing about a train nobody is waiting on any more.
  if (!OPEN.has(order.status)) {
    return { kind: 'booked', time: booked, certainty: 'context', booked, minutesVsBooked: null, direction: null, checkedMinutesAgo: null, pastDue: false }
  }

  // The railway has confirmed the train reached the station. Checked before
  // the estimate on purpose: an arrived reading is never stale and is never
  // polled again, so without this branch a train that passed at 2:55 would
  // keep being called "expected at 2:55" for as long as the order stayed open.
  if (timing?.arrived && timing.effectiveArrival) {
    return withDeviation({
      kind: 'arrived',
      time: timing.effectiveArrival,
      certainty: 'fact',
      booked,
      checkedMinutesAgo: timing.ageMinutes,
      pastDue: false,
    })
  }

  if (timing && timing.source === 'LIVE' && !timing.stale && timing.effectiveArrival) {
    return withDeviation({
      kind: 'expected',
      time: timing.effectiveArrival,
      certainty: 'estimate',
      booked,
      checkedMinutesAgo: timing.ageMinutes,
      pastDue: timing.effectiveArrival.getTime() < now.getTime(),
    })
  }

  return {
    kind: 'booked',
    time: booked,
    certainty: 'unverified',
    booked,
    minutesVsBooked: null,
    direction: null,
    checkedMinutesAgo: timing?.ageMinutes ?? null,
    pastDue: false,
  }
}

function withDeviation(
  r: Omit<ArrivalRecord, 'minutesVsBooked' | 'direction'>,
): ArrivalRecord {
  if (!r.time || !r.booked) return { ...r, minutesVsBooked: null, direction: null }
  const minutes = Math.round((r.time.getTime() - r.booked.getTime()) / 60_000)
  const direction =
    Math.abs(minutes) < MOVED_AFTER_MINUTES ? null : minutes > 0 ? 'later' : 'earlier'
  return { ...r, minutesVsBooked: minutes, direction }
}
