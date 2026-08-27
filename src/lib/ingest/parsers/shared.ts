/**
 * Helpers shared by aggregator parsers. Deliberately small — plan §6 is
 * explicit that each aggregator gets its own parser module rather than one
 * clever parser trying to serve both.
 */

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

/**
 * Parses `27-Aug 13:25` in Asia/Kolkata.
 *
 * The date carries no year. Plan §6 says: take the year from the email
 * timestamp, and add one if the result lands more than 7 days before it.
 *
 * That rule is right for the case it names — an email sent 31 Dec about a
 * 1 Jan service — but it only bends one way. An email arriving 2 Jan about a
 * 31-Dec service resolves to 31 Dec of the *following* year under it, which is
 * a year wrong. Choosing whichever candidate year falls nearest the email
 * timestamp gives the plan's answer in the plan's case and the right answer in
 * the mirror case too.
 */
export function parseAggregatorDate(raw: string, receivedAt: Date): Date | null {
  const m = /(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*\s+(\d{1,2}):(\d{2})/.exec(raw.trim())
  if (!m) return null

  const day = Number(m[1])
  const month = MONTHS[m[2].toLowerCase()]
  const hour = Number(m[3])
  const minute = Number(m[4])
  if (month === undefined || day < 1 || day > 31 || hour > 23 || minute > 59) return null

  const receivedYearIST = Number(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric' }).format(receivedAt),
  )

  const build = (year: number) => {
    const iso =
      `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` +
      `T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+05:30`
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? null : d
  }

  const candidates = [
    build(receivedYearIST - 1),
    build(receivedYearIST),
    build(receivedYearIST + 1),
  ].filter((d): d is Date => d !== null)

  if (candidates.length === 0) return null

  return candidates.reduce((best, c) =>
    Math.abs(c.getTime() - receivedAt.getTime()) < Math.abs(best.getTime() - receivedAt.getTime())
      ? c
      : best,
  )
}

/** 'YYYY-MM-DD' in IST for a given instant. */
export function serviceDateFor(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d)
}

/** Strips emoji and variation selectors, so positional fallback still works. */
export function stripEmoji(s: string): string {
  return s
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
    .trim()
}

/** Rupees like "236" or "1,250.50" to integer paise. */
export function rupeeStringToPaise(raw: string): number | null {
  const n = Number(raw.replace(/,/g, ''))
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

export function normalisePaymentMode(raw: string): 'PREPAID' | 'COD' | 'INVOICE' | null {
  const v = raw.trim().toUpperCase()
  if (v === 'CASH_ON_DELIVERY' || v === 'COD' || v === 'CASH') return 'COD'
  if (v === 'PREPAID' || v === 'PAID' || v === 'ONLINE') return 'PREPAID'
  if (v === 'INVOICE' || v === 'CREDIT') return 'INVOICE'
  return null
}

/** A phone number is 10 digits, possibly with +91 or spaces around it. */
export function looksLikePhone(s: string): boolean {
  const digits = s.replace(/\D/g, '')
  return digits.length >= 10 && digits.length <= 13
}
