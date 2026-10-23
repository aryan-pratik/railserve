/**
 * Rules for what a rider can see and change of the orders they have finished.
 *
 * Pure, so the mobile API, the repository and the tests all read one copy.
 */

/** How long after an order closes its rider may still correct the outcome. */
export const RIDER_CORRECTION_WINDOW_MS = 30 * 60 * 60 * 1000

/** How far back the rider's Done tab reaches when no date is picked. */
export const RIDER_RECENT_WINDOW_MS = 48 * 60 * 60 * 1000

/** The outcomes a rider may move a closed order between. */
export const RIDER_OUTCOMES = ['DELIVERED', 'FAILED', 'CANCELLED'] as const
export type RiderOutcome = (typeof RIDER_OUTCOMES)[number]

export function isRiderOutcome(s: string): s is RiderOutcome {
  return (RIDER_OUTCOMES as readonly string[]).includes(s)
}

/**
 * The rider wallet starts counting here. COD delivered before the handover
 * feature existed was settled by hand already, and counting it would open
 * every rider's wallet at months of cash they no longer hold.
 */
export const COD_WALLET_FROM = new Date('2026-10-23T00:00:00+05:30')

type Closable = {
  updatedAt?: Date | null
  delivery?: { closedAt?: Date | null; deliveredAt?: Date | null } | null
  events?: { toStatus?: string | null; createdAt?: Date | null }[] | null
}

const CLOSING = new Set(['DELIVERED', 'FAILED', 'CANCELLED', 'MISDELIVERY', 'MISSED_DELIVERY', 'REFUNDED', 'LOST'])

/**
 * When the order first closed.
 *
 * `delivery.closedAt` is authoritative. Orders closed before it existed fall
 * back to the first closing event, then deliveredAt, then updatedAt — the last
 * only so a malformed order still has an answer rather than staying open to
 * correction forever.
 */
export function closedAtOf(order: Closable): Date | null {
  if (order.delivery?.closedAt) return new Date(order.delivery.closedAt)
  const event = order.events?.find((e) => e.toStatus && CLOSING.has(e.toStatus) && e.createdAt)
  if (event?.createdAt) return new Date(event.createdAt)
  if (order.delivery?.deliveredAt) return new Date(order.delivery.deliveredAt)
  return order.updatedAt ? new Date(order.updatedAt) : null
}

/** Until when the rider may still correct this order, or null once it is past. */
export function correctableUntil(closedAt: Date | null, now: Date = new Date()): Date | null {
  if (!closedAt) return null
  const until = new Date(closedAt.getTime() + RIDER_CORRECTION_WINDOW_MS)
  return until > now ? until : null
}

/**
 * A passenger's number as a rider sees it once the job is behind them: the
 * first three and last three digits, so "was that the 98…210 one?" still has
 * an answer without the rider keeping a contact list of every passenger.
 *
 * A +91 / 0 prefix is dropped first — otherwise "the first three" would be the
 * country code and say nothing.
 */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  let digits = phone.replace(/\D/g, '')
  if (digits.length > 10 && digits.startsWith('91')) digits = digits.slice(-10)
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  if (digits.length <= 6) return '•'.repeat(digits.length)
  return `${digits.slice(0, 3)}${'•'.repeat(digits.length - 6)}${digits.slice(-3)}`
}

/** IST calendar day as a [start, end) UTC range. */
export function istDayRange(date: string): { from: Date; to: Date } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const from = new Date(`${date}T00:00:00+05:30`)
  if (Number.isNaN(from.getTime())) return null
  return { from, to: new Date(from.getTime() + 24 * 60 * 60 * 1000) }
}

/** Escapes text for use inside a MongoDB $regex. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
