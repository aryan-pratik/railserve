import type { Role } from './roles'
import type { OrderStatus } from './orderStatus'

/**
 * Return to origin (RTO): food that left the counter in a rider's hands and
 * is not being delivered has to come back to the outlet it was picked up
 * from, and somebody at that counter has to say it did.
 *
 * Pure rules, so the transition engine, the repository, the pages and the
 * tests all read one copy.
 */

export const RTO_STATUSES = ['PENDING', 'RETURNED'] as const
export type RtoStatus = (typeof RTO_STATUSES)[number]

/**
 * Leaving DISPATCHED for one of these opens a return. Only DISPATCHED: a
 * cancel while the order is still cooking, or sitting ready on the shelf,
 * never left the counter and has nothing to bring back. MISSED_DELIVERY is
 * here because the rider missed the train with the bag still in hand;
 * MISDELIVERY is not, because the bag went to the wrong passenger and is gone.
 */
export const RTO_OPENING_STATUSES: readonly OrderStatus[] = ['CANCELLED', 'FAILED', 'MISSED_DELIVERY']

export function opensReturn(from: OrderStatus, to: OrderStatus): boolean {
  return from === 'DISPATCHED' && RTO_OPENING_STATUSES.includes(to)
}

/**
 * The roles an admin may let collect a return at the counter. A rider is
 * never on this list: they are the one handing the bag back, and the whole
 * point of the mark is that somebody else confirms it arrived. An admin
 * always may.
 */
export const RTO_COLLECTOR_ROLE_OPTIONS = ['STORE_MANAGER', 'TELECALLER'] as const satisfies readonly Role[]
export type RtoCollectorRole = (typeof RTO_COLLECTOR_ROLE_OPTIONS)[number]

/** What a fresh install allows: the store manager, who is at the counter. */
export const DEFAULT_RTO_COLLECT_ROLES: readonly RtoCollectorRole[] = ['STORE_MANAGER']

export function canCollectReturn(role: Role, allowed: readonly string[]): boolean {
  if (role === 'ADMIN') return true
  return (RTO_COLLECTOR_ROLE_OPTIONS as readonly string[]).includes(role) && allowed.includes(role)
}

/** Keeps only the roles that can be granted, each once, in option order. */
export function normaliseRtoRoles(raw: readonly string[]): RtoCollectorRole[] {
  return RTO_COLLECTOR_ROLE_OPTIONS.filter((r) => raw.includes(r))
}

export const RTO_NOTE_MAX = 500

/** How the reason a return was opened reads on a card or a row. */
export function rtoReasonLabel(reason: string): string {
  switch (reason) {
    case 'CANCELLED':
      return 'Cancelled on the way'
    case 'FAILED':
      return 'Not delivered'
    case 'MISSED_DELIVERY':
      return 'Missed the train'
    default:
      return reason.replace(/_/g, ' ').toLowerCase()
  }
}
