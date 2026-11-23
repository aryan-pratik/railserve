import type { Role } from './roles'

export const ORDER_STATUSES = [
  'ENQUIRY',
  'QUOTED',
  'RECEIVED',
  'ACCEPTED',
  'KOT_PRINTED',
  'PREPARED',
  'DISPATCHED',
  'DELIVERED',
  'FAILED',
  'CANCELLED',
  'LOST',
] as const

export type OrderStatus = (typeof ORDER_STATUSES)[number]

/**
 * Statuses that existed before the 2026-11 clean-up, kept only so old event
 * logs still read in plain words. No order is in one of these any more: see
 * lib/repo/statusCleanup.ts, which converted them at boot.
 *
 *   MISDELIVERY, MISSED_DELIVERY  -> FAILED, with the matching failure reason
 *   REFUNDED                      -> its real status, plus order.refund
 *   RATING_ORDER                  -> its real status, plus order.ratingOrder
 */
export const RETIRED_STATUSES = ['MISDELIVERY', 'MISSED_DELIVERY', 'MISSED_DELEVERY', 'REFUNDED', 'REFUND', 'RATING_ORDER'] as const

/**
 * Why an order did not reach the passenger (FAILED), or why a group booking
 * was not booked (LOST). Stored as the code in delivery.failureReason; older
 * rows and the rider app may hold free text, which is shown as written.
 */
export const FAILURE_REASONS = {
  MISSED_TRAIN: 'Missed the train',
  WRONG_PASSENGER: 'Given to the wrong passenger',
  PASSENGER_NOT_FOUND: 'Passenger not found',
  PASSENGER_REFUSED: 'Passenger refused it',
  TRAIN_LATE_OR_CANCELLED: 'Train late or cancelled',
  OTHER: 'Other',
} as const
export type FailureReason = keyof typeof FAILURE_REASONS

export const NOT_BOOKED_REASONS = {
  TOO_EXPENSIVE: 'Price too high',
  CHANGED_PLANS: 'Changed their plans',
  NO_REPLY: 'Stopped replying',
  BOOKED_ELSEWHERE: 'Booked somewhere else',
  OTHER: 'Other',
} as const
export type NotBookedReason = keyof typeof NOT_BOOKED_REASONS

/** A stored reason, in words: a known code, or free text as it was typed. */
export function reasonLabel(raw: string | null | undefined): string | null {
  if (!raw) return null
  return (FAILURE_REASONS as Record<string, string>)[raw] ?? (NOT_BOOKED_REASONS as Record<string, string>)[raw] ?? raw
}

/** Refunds: why, and who pays the passenger back. */
export const REFUND_REASONS = {
  NOT_DELIVERED: 'Not delivered',
  LATE: 'Late',
  WRONG_OR_MISSING_ITEM: 'Wrong or missing item',
  QUALITY: 'Food quality',
  CANCELLED: 'Cancelled',
  OTHER: 'Other',
} as const
export type RefundReason = keyof typeof REFUND_REASONS
export const REFUND_PAYERS = { AGGREGATOR: 'The aggregator (taken off our payout)', US: 'We paid it back' } as const
export type RefundPayer = keyof typeof REFUND_PAYERS

/**
 * The transition allow-list. Plan §4.
 *
 * Anything not listed here throws. This is the single source of truth for what
 * may follow what, and who is permitted to do it — encoding the role alongside
 * the edge keeps §5's permission table and §4's state machine from drifting
 * apart, which they would if they lived in separate files.
 *
 * Retail enters at RECEIVED; bulk enters at ENQUIRY and merges at RECEIVED.
 *
 * A TELECALLER appears on two kinds of edge. `-> CANCELLED`, from every
 * state of the shared pipeline: they ring the passenger, the passenger
 * cancels, and the cancellation has to reach the kitchen (or the rider).
 * And `-> DELIVERED` / `-> FAILED` ("not delivered", with a reason): the
 * passenger tells them how it went, recorded whether or not the rider tapped
 * anything. FAILED is open from the kitchen stages too, for food that missed
 * its train before it left the counter.
 *
 * Refunds and rating orders are not statuses: a refund is recorded on the
 * order (order.refund) whatever its status, and a rating order is a tag
 * (order.ratingOrder). See RETIRED_STATUSES above.
 */
export const TRANSITIONS: Record<OrderStatus, Partial<Record<OrderStatus, readonly Role[]>>> = {
  // --- bulk-only head of the pipeline ---
  ENQUIRY: {
    QUOTED: ['ADMIN'],
    LOST: ['ADMIN'],
  },
  QUOTED: {
    // Guarded additionally by the completeness check below.
    RECEIVED: ['ADMIN'],
    LOST: ['ADMIN'],
  },

  // --- shared pipeline ---
  RECEIVED: {
    ACCEPTED: ['ADMIN', 'STORE_MANAGER'],
    CANCELLED: ['ADMIN', 'TELECALLER'],
    // The train left before the food did: not delivered, "missed the train".
    FAILED: ['TELECALLER'],
  },
  ACCEPTED: {
    KOT_PRINTED: ['ADMIN', 'STORE_MANAGER'],
    CANCELLED: ['ADMIN', 'TELECALLER'],
    // The train left before the food did: not delivered, "missed the train".
    FAILED: ['TELECALLER'],
  },
  KOT_PRINTED: {
    PREPARED: ['ADMIN', 'STORE_MANAGER'],
    CANCELLED: ['ADMIN', 'TELECALLER'],
    // The train left before the food did: not delivered, "missed the train".
    FAILED: ['TELECALLER'],
  },
  PREPARED: {
    // A store manager can hand food over on the rider's behalf: the rider is
    // often at the counter with their hands full, and making them stop to
    // unlock a phone at the one moment the clock matters is how orders miss a
    // halt. The manager must name who took it — see `handedTo` in
    // transitionOrder — so the record still says which rider has the food.
    // An admin can do the same from their own board, under the same rule.
    DISPATCHED: ['DELIVERY_AGENT', 'STORE_MANAGER', 'ADMIN'],
    // A telecaller may close the order out from the counter too: when the
    // rider never tapped "on the way" but the passenger confirms on the phone
    // that the food arrived (or did not), that call is the outcome.
    DELIVERED: ['TELECALLER'],
    FAILED: ['TELECALLER'],
    CANCELLED: ['ADMIN', 'TELECALLER'],
  },
  DISPATCHED: {
    // The rider records these from the platform; a telecaller records them
    // from the passenger's word on the phone, which is often the first anyone
    // hears of how a delivery went.
    DELIVERED: ['DELIVERY_AGENT', 'TELECALLER'],
    FAILED: ['DELIVERY_AGENT', 'TELECALLER'],
    // Cancelling food already on its way is rare (a train diverted after the
    // rider left the counter), but it is the call desk's or an admin's call to
    // make, and the rider's screen drops the order the moment it happens.
    CANCELLED: ['ADMIN', 'TELECALLER'],
    // Taking an order is one tap on a phone held in a busy hand, so it gets
    // mistapped. Putting it back is the correction: the food returns to the
    // counter for someone else to take. Only the rider holding it may do this
    // — releasing a claim is theirs to make — and the event log records both
    // the take and the return, so a returned order is never silently un-taken.
    PREPARED: ['DELIVERY_AGENT'],
  },

  // --- terminal ---
  DELIVERED: {},
  FAILED: {},
  CANCELLED: {},
  LOST: {},
}

export const TERMINAL_STATUSES: readonly OrderStatus[] = [
  'DELIVERED',
  'FAILED',
  'CANCELLED',
  'LOST',
]

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

/**
 * Who may tag an order as a rating order: a decoy run purely to prompt an
 * app-store rating. A tag, not a status, so the order keeps its real status.
 */
export function canFlagRatingOrder(role: Role): boolean {
  return role === 'TELECALLER' || role === 'ADMIN'
}

/** Who may record (or take back) a refund on an order. */
export function canRecordRefund(role: Role): boolean {
  return role === 'TELECALLER' || role === 'ADMIN'
}

export function allowedNextStatuses(from: OrderStatus, role: Role): OrderStatus[] {
  const edges = TRANSITIONS[from] ?? {}
  return (Object.keys(edges) as OrderStatus[]).filter((to) => edges[to]!.includes(role))
}

export function isTransitionAllowed(from: OrderStatus, to: OrderStatus, role: Role): boolean {
  return (TRANSITIONS[from]?.[to] ?? []).includes(role)
}

/**
 * Plan §4 completeness guard: a bulk order cannot leave QUOTED for RECEIVED
 * until it is actually fulfillable. Enforced in transitionOrder(), never in the
 * UI — the UI is not the last line of defence.
 */
export const QUOTE_REQUIRED_FIELDS = [
  'restaurantId',
  'contactPhone',
  'amountPaise',
  'paymentMode',
  'readyBy',
] as const

export function missingQuoteFields(
  order: Record<string, unknown>,
): string[] {
  return QUOTE_REQUIRED_FIELDS.filter((f) => {
    const v = order[f]
    return v === null || v === undefined || v === ''
  })
}

/**
 * Shapes an admin-typed custom status ("Refund pending") into the same
 * SCREAMING_SNAKE_CASE form as the fixed statuses, so `statusLabel`'s fallback
 * formatter renders it back consistently (e.g. "Refund pending").
 */
export function normalizeCustomStatus(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/**
 * May this role ask for an order in this status to be cancelled?
 *
 * Only a store manager asks: a telecaller and an admin can cancel outright.
 * The request is open exactly where the person who will act on it could
 * cancel, so an accepted request never turns into an illegal transition.
 */
export function canRequestCancellation(role: Role, status: string): boolean {
  return (
    role === 'STORE_MANAGER' &&
    isTransitionAllowed(status as OrderStatus, 'CANCELLED', 'TELECALLER')
  )
}

/** Who answers a store manager's cancellation request. */
export function canDecideCancellation(role: Role): boolean {
  return role === 'TELECALLER' || role === 'ADMIN'
}
