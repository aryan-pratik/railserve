/**
 * Order enums with no Mongoose dependency.
 *
 * Separate from models/Order.ts on purpose: client components need these
 * values for form controls, and importing them from the model drags the whole
 * MongoDB driver into the browser bundle (which fails on `tls`, `net`, and
 * `timers/promises`). Keeping the vocabulary free of the ODM lets both sides
 * share one source of truth.
 */
export const ORDER_SOURCES = ['YATRIRESTRO', 'DAILYYATRI', 'OLF', 'YATRIBHOJAN', 'RAJBHOG', 'ZOOP', 'BROTHERBYTE', 'HOMEBYTES', 'RAILRESTRO', 'RELFOOD', 'MANUAL'] as const
export const ORDER_TYPES = ['RETAIL', 'BULK'] as const
export const PAYMENT_MODES = ['PREPAID', 'COD', 'INVOICE'] as const
export const PROOF_TYPES = ['OTP', 'PHOTO', 'SIGNATURE'] as const
export const TIMING_SOURCES = ['LIVE', 'SCHEDULED'] as const

export type OrderSource = (typeof ORDER_SOURCES)[number]
export type OrderType = (typeof ORDER_TYPES)[number]
export type PaymentMode = (typeof PAYMENT_MODES)[number]
export type ProofType = (typeof PROOF_TYPES)[number]
export type TimingSource = (typeof TIMING_SOURCES)[number]

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
  MANUAL: 'Entered by hand',
}

/** Falls back to the raw value, so an unrecognised source is visible rather than blank. */
export function sourceLabel(source: string | null | undefined): string {
  if (!source) return '—'
  return SOURCE_LABEL[source as OrderSource] ?? source
}
