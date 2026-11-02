/**
 * Phone numbers as WhatsApp wants them: digits only, country code first.
 *
 * Orders carry whatever the aggregator sent — "98765 43210", "+91-98765-43210",
 * "09876543210" — and a telecaller types whatever the passenger reads out.
 * All of those are the same WhatsApp account, so they all have to land on the
 * same conversation. India is the default country: that is where every train
 * this app serves runs.
 */

const INDIA = '91'

/**
 * Returns the canonical `91XXXXXXXXXX` form, or null when the input cannot be
 * a dialable number. Only Indian 10-digit mobiles get a country code added;
 * anything already carrying one (12+ digits) is kept as typed.
 */
export function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  let digits = raw.replace(/\D/g, '')
  // "0091…" and "+91…" both arrive as leading zeros once the plus is gone.
  digits = digits.replace(/^0+/, '')
  if (digits.length === 10) return INDIA + digits
  if (digits.length >= 11 && digits.length <= 15) return digits
  return null
}

/** `91XXXXXXXXXX` → `+91 XXXXX XXXXX`, for reading aloud on a call. */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return ''
  if (phone.startsWith(INDIA) && phone.length === 12) {
    const local = phone.slice(2)
    return `+91 ${local.slice(0, 5)} ${local.slice(5)}`
  }
  return `+${phone}`
}

/**
 * The last ten digits: how an order's `contactPhone` is matched to a
 * conversation, since orders store the number as the aggregator wrote it.
 */
export function phoneTail(phone: string): string {
  return phone.slice(-10)
}
