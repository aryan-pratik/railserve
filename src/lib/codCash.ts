/**
 * What a rider owes on a cash-on-delivery order, in one place so the rider
 * cash screens, the rider's own day figures and Reports never disagree.
 *
 * A rider owes the bill as it stood at the door (`billAtDoorPaise`, pinned
 * on delivery, so a later bill edit does not move it). The amount they type is kept as what
 * they *said* they got: when it is less, the gap is flagged as short, but it
 * stays owed until the office deals with it (UPI recorded, or the bill
 * corrected). Otherwise a typo, or a quiet discount, takes money off the
 * books with nobody noticing.
 *
 * Owed now = bill − cash already handed in − paid online.
 */

type CashFields = {
  amountPaise?: number | null
  delivery?: { billAtDoorPaise?: number | null; amountCollectedPaise?: number | null; codPartPaidPaise?: number | null; codOnlinePaise?: number | null } | null
}

/**
 * The bill a rider answers for: the bill at the door. Deliveries from before
 * that was kept fall back to what was recorded at the door, then the bill.
 */
export function billOf(o: CashFields): number {
  return o.delivery?.billAtDoorPaise ?? o.delivery?.amountCollectedPaise ?? o.amountPaise ?? 0
}

/** Still owed by the rider on this order. */
export function owedOf(o: CashFields): number {
  return Math.max(0, billOf(o) - (o.delivery?.codPartPaidPaise ?? 0) - (o.delivery?.codOnlinePaise ?? 0))
}

/** How much less than the bill the rider said they got, or 0. */
export function shortOf(o: CashFields): number {
  const said = o.delivery?.amountCollectedPaise
  const bill = o.delivery?.billAtDoorPaise
  if (said == null || bill == null) return 0
  return Math.max(0, bill - said - (o.delivery?.codOnlinePaise ?? 0))
}

/** The same bill, for aggregation pipelines. */
export const BILL_EXPR = {
  $ifNull: ['$delivery.billAtDoorPaise', { $ifNull: ['$delivery.amountCollectedPaise', { $ifNull: ['$amountPaise', 0] }] }],
}
export const PART_EXPR = { $ifNull: ['$delivery.codPartPaidPaise', 0] }
export const ONLINE_EXPR = { $ifNull: ['$delivery.codOnlinePaise', 0] }
/** Bill minus anything paid online: the cash that should reach the store. */
export const CASH_DUE_EXPR = { $max: [0, { $subtract: [BILL_EXPR, ONLINE_EXPR] }] }
