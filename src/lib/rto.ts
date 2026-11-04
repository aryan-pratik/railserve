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
 * May this person mark a return as back at the counter?
 *
 * An admin always may. A store manager may when an admin has ticked
 * "collects returns" on their staff record — per person, because one manager
 * owns the counter at an outlet and the rest need not. Nobody else: a rider
 * is the one handing the bag over, and the mark is somebody else confirming
 * it arrived; a telecaller is on the phone, not at the counter.
 */
export function canCollectReturns(user: { role: Role; canCollectReturns?: boolean | null }): boolean {
  if (user.role === 'ADMIN') return true
  return user.role === 'STORE_MANAGER' && user.canCollectReturns === true
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
