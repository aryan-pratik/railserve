import type { Role } from './roles'

/**
 * One order, three readings of where it stands.
 *
 * `status` is the pipeline: fifteen values, because the kitchen, the rider and
 * the call desk each need their own steps. Shown raw everywhere, it made every
 * screen speak in all fifteen: a rider read "KOT printed", a kitchen read
 * "Missed delivery", and a report had to decide for itself whether "Failed"
 * counted as a cancellation. So each audience gets its own reading, derived
 * from the same stored facts and never stored beside them, which is what
 * keeps the three from disagreeing:
 *
 * - overall: PROCESSING, DELIVERED or CANCELLED. For reports and totals.
 * - kitchen: how far the food is. For the store and the call desk.
 * - rider: what the rider has to do, or did. For the rider app and the
 *   rider's record.
 *
 * Pure and free of the database, so client components can import it.
 */

type Viewable = {
  status: string
  delivery?: {
    dispatchedAt?: Date | string | null
    agentIds?: unknown[] | null
    rto?: { status?: string | null } | null
  } | null
}

export const OVERALL_STATUSES = ['PROCESSING', 'DELIVERED', 'CANCELLED'] as const
export type OverallStatus = (typeof OVERALL_STATUSES)[number]

export const OVERALL_LABEL: Record<OverallStatus, string> = {
  PROCESSING: 'Processing',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
}

/**
 * Every closing status that is not a delivery counts as cancelled: the
 * passenger did not get the food, whoever's doing that was. FAILED and
 * MISSED_DELIVERY are here by the business's own rule; MISDELIVERY because
 * the bag reached the wrong person; LOST and REFUNDED because no sale stood.
 * RATING_ORDER is a decoy that was never a real order, and counts with them
 * rather than inflating the delivered figure.
 */
export const OVERALL_CANCELLED_STATUSES = [
  'CANCELLED', 'FAILED', 'MISSED_DELIVERY', 'MISDELIVERY', 'LOST', 'REFUNDED', 'RATING_ORDER',
] as const

/** Statuses still in the works. A custom admin status is in the works too. */
export const OVERALL_PROCESSING_STATUSES = [
  'ENQUIRY', 'QUOTED', 'RECEIVED', 'ACCEPTED', 'KOT_PRINTED', 'PREPARED', 'DISPATCHED',
] as const

export function overallStatus(status: string): OverallStatus {
  if (status === 'DELIVERED') return 'DELIVERED'
  if ((OVERALL_CANCELLED_STATUSES as readonly string[]).includes(status)) return 'CANCELLED'
  return 'PROCESSING'
}

/** The stored statuses behind one overall status, for a query. Custom statuses are not listed. */
export function statusesOfOverall(overall: OverallStatus): readonly string[] {
  if (overall === 'DELIVERED') return ['DELIVERED']
  if (overall === 'CANCELLED') return OVERALL_CANCELLED_STATUSES
  return OVERALL_PROCESSING_STATUSES
}

export const KITCHEN_STATUSES = [
  'ENQUIRY', 'NEW', 'ACCEPTED', 'COOKING', 'READY', 'OUT', 'RETURNING', 'CLOSED',
] as const
export type KitchenStatus = (typeof KITCHEN_STATUSES)[number]

export const KITCHEN_LABEL: Record<KitchenStatus, string> = {
  ENQUIRY: 'Enquiry',
  NEW: 'New',
  ACCEPTED: 'Accepted',
  COOKING: 'Cooking',
  READY: 'Ready',
  OUT: 'With rider',
  RETURNING: 'Coming back',
  CLOSED: 'Closed',
}

/**
 * How far the food is, as the counter sees it. Once the bag has left, the
 * kitchen's only remaining question is whether it is coming back, so every
 * closing status folds into CLOSED unless a return is still open.
 */
export function kitchenStatus(order: Viewable): KitchenStatus {
  switch (order.status) {
    case 'ENQUIRY':
    case 'QUOTED':
      return 'ENQUIRY'
    case 'RECEIVED':
      return 'NEW'
    case 'ACCEPTED':
      return 'ACCEPTED'
    case 'KOT_PRINTED':
      return 'COOKING'
    case 'PREPARED':
      return 'READY'
    case 'DISPATCHED':
      return 'OUT'
    default:
      if (overallStatus(order.status) === 'PROCESSING') return 'NEW'
      return order.delivery?.rto?.status === 'PENDING' ? 'RETURNING' : 'CLOSED'
  }
}

export const RIDER_STATUSES = [
  'NOT_READY', 'READY', 'PICKED_UP', 'DELIVERED', 'NOT_DELIVERED', 'RETURN_PENDING', 'RETURNED', 'CANCELLED',
] as const
export type RiderStatus = (typeof RIDER_STATUSES)[number]

export const RIDER_LABEL: Record<RiderStatus, string> = {
  NOT_READY: 'Being prepared',
  READY: 'Ready to pick up',
  PICKED_UP: 'Picked up',
  DELIVERED: 'Delivered',
  NOT_DELIVERED: 'Not delivered',
  RETURN_PENDING: 'Bring back to outlet',
  RETURNED: 'Returned to outlet',
  CANCELLED: 'Cancelled',
}

/**
 * What the rider has to do, or did.
 *
 * A bag that left the counter and was not delivered is the rider's until the
 * outlet takes it back, so an open return outranks the reason it was opened:
 * "bring it back" is the instruction, whether the passenger was missing or
 * the office cancelled. An order closed before the rider ever held it is
 * simply cancelled as far as they are concerned.
 */
export function riderStatus(order: Viewable): RiderStatus {
  const s = order.status
  if (s === 'DISPATCHED') return 'PICKED_UP'
  if (s === 'PREPARED') return 'READY'
  if (s === 'DELIVERED') return 'DELIVERED'
  if (overallStatus(s) === 'PROCESSING') return 'NOT_READY'
  const rto = order.delivery?.rto?.status
  if (rto === 'PENDING') return 'RETURN_PENDING'
  if (rto === 'RETURNED') return 'RETURNED'
  if (s === 'FAILED' || s === 'MISSED_DELIVERY' || s === 'MISDELIVERY') return 'NOT_DELIVERED'
  return 'CANCELLED'
}

/**
 * The status wording a role should read first. An admin reads the pipeline
 * status itself, since they are the one who can act on every step of it.
 */
export function statusLabelFor(role: Role, order: Viewable): string | null {
  if (role === 'DELIVERY_AGENT') return RIDER_LABEL[riderStatus(order)]
  if (role === 'STORE_MANAGER') return KITCHEN_LABEL[kitchenStatus(order)]
  return null
}
