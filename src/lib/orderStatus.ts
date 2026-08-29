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
 * The transition allow-list. Plan §4.
 *
 * Anything not listed here throws. This is the single source of truth for what
 * may follow what, and who is permitted to do it — encoding the role alongside
 * the edge keeps §5's permission table and §4's state machine from drifting
 * apart, which they would if they lived in separate files.
 *
 * Retail enters at RECEIVED; bulk enters at ENQUIRY and merges at RECEIVED.
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
    CANCELLED: ['ADMIN'],
  },
  ACCEPTED: {
    KOT_PRINTED: ['ADMIN', 'STORE_MANAGER'],
    CANCELLED: ['ADMIN'],
  },
  KOT_PRINTED: {
    PREPARED: ['ADMIN', 'STORE_MANAGER'],
    CANCELLED: ['ADMIN'],
  },
  PREPARED: {
    // A store manager can hand food over on the rider's behalf: the rider is
    // often at the counter with their hands full, and making them stop to
    // unlock a phone at the one moment the clock matters is how orders miss a
    // halt. The manager must name who took it — see `handedTo` in
    // transitionOrder — so the record still says which rider has the food.
    DISPATCHED: ['DELIVERY_AGENT', 'STORE_MANAGER'],
    CANCELLED: ['ADMIN'],
  },
  DISPATCHED: {
    DELIVERED: ['DELIVERY_AGENT'],
    FAILED: ['DELIVERY_AGENT'],
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
