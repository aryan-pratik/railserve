/**
 * Order enums with no Mongoose dependency.
 *
 * Separate from models/Order.ts on purpose: client components need these
 * values for form controls, and importing them from the model drags the whole
 * MongoDB driver into the browser bundle (which fails on `tls`, `net`, and
 * `timers/promises`). Keeping the vocabulary free of the ODM lets both sides
 * share one source of truth.
 */
export const ORDER_SOURCES = ['YATRIRESTRO', 'DAILYYATRI', 'OLF', 'YATRIBHOJAN', 'RAJBHOG', 'MANUAL'] as const
export const ORDER_TYPES = ['RETAIL', 'BULK'] as const
export const PAYMENT_MODES = ['PREPAID', 'COD', 'INVOICE'] as const
export const PROOF_TYPES = ['OTP', 'PHOTO', 'SIGNATURE'] as const
export const TIMING_SOURCES = ['LIVE', 'SCHEDULED'] as const

export type OrderSource = (typeof ORDER_SOURCES)[number]
export type OrderType = (typeof ORDER_TYPES)[number]
export type PaymentMode = (typeof PAYMENT_MODES)[number]
export type ProofType = (typeof PROOF_TYPES)[number]
export type TimingSource = (typeof TIMING_SOURCES)[number]
