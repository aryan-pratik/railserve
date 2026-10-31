import { ORDER_STATUSES, TERMINAL_STATUSES } from './orderStatus'
import type { TimingView } from './train/policy'
import { todayIST } from './format'

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
  /** Set when the railway timetable moved scheduledArrival; see rescheduledArrival. */
  bookedArrival?: Date | null
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
  // Shown when nothing live is: the railway-corrected time, if it was moved.
  const scheduled = order.scheduledArrival ?? null
  // Measured against: always what the aggregator booked, so a correction onto
  // the railway's day never hides how far the booking was out.
  const booked = order.bookedArrival ?? scheduled
  const deliveredAt = order.delivery?.deliveredAt ?? null

  if (order.status === 'DELIVERED' && deliveredAt) {
    return withDeviation({ kind: 'delivered', time: deliveredAt, certainty: 'fact', booked, checkedMinutesAgo: null, pastDue: false })
  }

  // Anything not on the open path, including a custom status an admin typed
  // in, is a closed record: the booked time is context, and nothing live is
  // worth showing about a train nobody is waiting on any more.
  if (!OPEN.has(order.status)) {
    return { kind: 'booked', time: scheduled, certainty: 'context', booked, minutesVsBooked: null, direction: null, checkedMinutesAgo: null, pastDue: false }
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
    time: scheduled,
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

/**
 * Past this, a booking is not merely a stale copy of the timetable. Bookings
 * on this route run up to about two hours out; one further off than this is
 * left as booked, so the gap shows on screen for a person to resolve.
 */
export const SAME_TRAIN_WITHIN_MS = 6 * 3_600_000

/**
 * The railway's timetabled arrival, when it moves the booking onto another day.
 *
 * Aggregators book against their own copy of the timetable, and it goes out
 * of date. 15565 was booked into Kanpur at 00:02 on 30 Oct while the railway
 * had it there at 23:40 on the 29th — the same train, 22 minutes apart, but
 * on different days. A booking off by minutes on the same day stays as it is:
 * the gap between booked and expected is worth seeing. One that puts the
 * train on the wrong day is simply wrong, and every screen that reads it
 * (the board, the order page, the KOT) shows a date the train never came.
 *
 * Null when there is nothing to correct: no booking, no timetable, the same
 * day already, or too far apart to be the same booking (SAME_TRAIN_WITHIN_MS).
 */
export function rescheduledArrival(booked: Date | null, timetable: Date | null): Date | null {
  if (!booked || !timetable) return null
  if (Math.abs(timetable.getTime() - booked.getTime()) >= SAME_TRAIN_WITHIN_MS) return null
  if (todayIST(booked) === todayIST(timetable)) return null
  return timetable
}

/**
 * True when an admin set this order's arrival or service date by hand. The
 * railway timetable never overrules that, on the record or on screen.
 */
export function timedByAdmin(order: { events?: { meta?: unknown }[] | null }): boolean {
  return (order.events ?? []).some((e) => {
    const m = (e.meta ?? {}) as Record<string, unknown>
    return (
      m.action === 'FIELD_EDITED' &&
      m.via === 'admin-detail' &&
      (m.field === 'scheduledArrival' || m.field === 'serviceDate')
    )
  })
}

/** A booking further in the past than this is a train long gone. */
const GONE_AFTER_MS = 12 * 3_600_000

/**
 * The booking a train run is looked up against: the earliest one that is not
 * long gone, or failing that the earliest of all.
 *
 * One cache row serves every order on a train, station and service date, and
 * those can belong to two runs — last night's 23:40, moved onto its real
 * evening after midnight, beside tonight's 23:40 booked correctly. The
 * earliest alone would keep the row on last night's train all day for as
 * long as that order stays open. Null when nothing is booked.
 */
export function runBooking(bookings: (Date | null | undefined)[], now: Date): Date | null {
  const known = bookings.filter((b): b is Date => b instanceof Date).sort((a, b) => a.getTime() - b.getTime())
  return known.find((b) => b.getTime() >= now.getTime() - GONE_AFTER_MS) ?? known[0] ?? null
}
