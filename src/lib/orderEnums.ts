/**
 * Order enums with no Mongoose dependency.
 *
 * Separate from models/Order.ts on purpose: client components need these
 * values for form controls, and importing them from the model drags the whole
 * MongoDB driver into the browser bundle (which fails on `tls`, `net`, and
 * `timers/promises`). Keeping the vocabulary free of the ODM lets both sides
 * share one source of truth.
 */
export const ORDER_SOURCES = ['YATRIRESTRO', 'DAILYYATRI', 'OLF', 'YATRIBHOJAN', 'RAJBHOG', 'ZOOP', 'BROTHERBYTE', 'HOMEBYTES', 'RAILRESTRO', 'RELFOOD', 'FOODONTRAINS', 'NOTIFICATION', 'MANUAL'] as const
/**
 * RETAIL is one passenger on a train, BULK is a group handover to a train, and
 * LOCAL is an order that never boards a train at all: a stall at the station,
 * a counter pickup, a delivery somewhere on the platform or nearby. A local
 * order carries no train number, PNR, coach or berth; where it goes is in
 * `handoverPoint`.
 */
export const ORDER_TYPES = ['RETAIL', 'BULK', 'LOCAL'] as const
export const PAYMENT_MODES = ['PREPAID', 'COD', 'INVOICE'] as const
export const PROOF_TYPES = ['OTP', 'PHOTO', 'SIGNATURE'] as const
export const TIMING_SOURCES = ['LIVE', 'SCHEDULED'] as const

export type OrderSource = (typeof ORDER_SOURCES)[number]
export type OrderType = (typeof ORDER_TYPES)[number]
export type PaymentMode = (typeof PAYMENT_MODES)[number]
export type ProofType = (typeof PROOF_TYPES)[number]
export type TimingSource = (typeof TIMING_SOURCES)[number]

export const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  RETAIL: 'Retail',
  BULK: 'Bulk',
  LOCAL: 'Local',
}

/** Orders of this type never ride a train, so train fields do not apply. */
export function isLocalOrder(o: { orderType?: string | null }): boolean {
  return o.orderType === 'LOCAL'
}

/**
 * How each aggregator is written for a person to read.
 *
 * `source` is the platform the order arrived from, and it is the one part of
 * the outlet/aggregator split that was modelled correctly from day one — the
 * storefront name and the kitchen moved around it (see models/Listing.ts), but
 * this field always meant exactly one thing.
 *
 * MANUAL is not a platform, so it does not get a brand name: an order somebody
 * typed in should read as that, not as a tenth aggregator nobody recognises.
 */
export const SOURCE_LABEL: Record<OrderSource, string> = {
  YATRIRESTRO: 'Yatri Restro',
  DAILYYATRI: 'Daily Yatri',
  OLF: 'OLF',
  YATRIBHOJAN: 'Yatri Bhojan',
  RAJBHOG: 'RajBhog',
  ZOOP: 'Zoop',
  BROTHERBYTE: 'BrotherByte',
  HOMEBYTES: 'HomeBytes',
  RAILRESTRO: 'RailRestro',
  RELFOOD: 'RelFood',
  FOODONTRAINS: 'FoodOnTrains',
  // The "New Order Notification" message, which names no vendor.
  NOTIFICATION: 'Order notification',
  MANUAL: 'Entered by hand',
}

/** Falls back to the raw value, so an unrecognised source is visible rather than blank. */
export function sourceLabel(source: string | null | undefined): string {
  if (!source) return '—'
  return SOURCE_LABEL[source as OrderSource] ?? source
}
