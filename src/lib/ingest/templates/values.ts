import { MONTHS, looksLikePhone, normalisePaymentMode, rupeeStringToPaise, stationCodeForName } from '../parsers/shared'
import type { DateOrder } from './types'

/**
 * Turns the raw text a template read into typed order fields. Each reader is
 * forgiving about decoration ("₹", "Rs.", "(3749) ", "Coach/Seat:") and strict
 * about the result: anything it cannot be sure of comes back null rather than
 * guessed, and the ingestion then reports that field as missing.
 *
 * Only fixed, written-here patterns are used; none comes from an admin.
 */

export function readOrderId(raw: string): string | null {
  const v = raw.trim().replace(/^[#:\s]+/, '').replace(/[.,;]+$/, '')
  // An order number is one token; "ZO123 Type" means the stop was too late.
  const token = v.split(/\s+/)[0] ?? ''
  return token.length >= 3 && token.length <= 60 ? token : null
}

export function readName(raw: string): string | null {
  const v = raw.trim().replace(/^[:\-–\s]+/, '').replace(/[,;:\s]+$/, '').replace(/\s+/g, ' ')
  return v && v.length <= 120 ? v : null
}

export function readPhone(raw: string): string | null {
  if (!looksLikePhone(raw)) return null
  return raw.replace(/\D/g, '').slice(-10)
}

export function readTrainNo(raw: string): string | null {
  return /\b(\d{4,5})\b/.exec(raw)?.[1] ?? null
}

/** "Pnvl Gkp Express/ 15066" or "12554 - VAISHALI EXP" → the words only. */
export function readTrainName(raw: string): string | null {
  const v = raw.replace(/\b\d{3,6}\b/g, ' ').replace(/[\/|()\-–:]+/g, ' ').replace(/\s+/g, ' ').trim()
  return v.length >= 2 && v.length <= 80 ? v : null
}

/**
 * "S1/ 61", "S1-61", "B5 10", "Coach B5 Seat 10", "B5,10" → coach and berth.
 * A seat it cannot split stays as written in rawSeat, with no coach/berth.
 */
export function readSeat(raw: string): { coach: string | null; berth: string | null; rawSeat: string | null } {
  const cleaned = raw
    .replace(/\b(coach|seat|berth|no\.?)\b/gi, ' ')
    .replace(/[:]/g, ' ')
    .trim()
  const m = /^([A-Za-z]{1,3}\d{0,2})\s*[\/\-,\s]\s*(\d{1,3}[A-Za-z]{0,2})\b/.exec(cleaned)
  if (m) {
    const coach = m[1].toUpperCase()
    return { coach, berth: m[2].toUpperCase(), rawSeat: `${coach}-${m[2].toUpperCase()}` }
  }
  const v = raw.trim().replace(/\s+/g, ' ')
  return { coach: null, berth: null, rawSeat: v ? v.slice(0, 40) : null }
}

/**
 * A station code: "CNB", "Kanpur Central/ CNB", "Kanpur Central (CNB)", or a
 * known station name. Returns the name too when one was printed.
 */
export function readStation(raw: string): { code: string | null; name: string | null } {
  const v = raw.trim()
  const bracket = /^(.*?)[\s(\/\-–]+([A-Za-z]{2,5})\)?$/.exec(v)
  if (/^[A-Za-z]{2,5}$/.test(v)) return { code: v.toUpperCase(), name: null }
  if (bracket && bracket[1].trim() && bracket[2] === bracket[2].toUpperCase()) {
    return { code: bracket[2].toUpperCase(), name: bracket[1].trim().replace(/[\/(\-–]+$/, '').trim() || null }
  }
  const lead = /^([A-Z]{2,5})\s*[-–\/:]\s*(.+)$/.exec(v)
  if (lead) return { code: lead[1], name: lead[2].trim() }
  const byName = stationCodeForName(v)
  return { code: byName, name: v || null }
}

/** "(3749) The Cosmozin Lounge" → "The Cosmozin Lounge". */
export function readOutlet(raw: string): string | null {
  const v = raw.trim().replace(/^\(\s*\d+\s*\)\s*/, '').replace(/\s+/g, ' ')
  return v && v.length <= 120 ? v : null
}

/** The first amount in the text: "₹ 1,259.50", "Rs. 259/-", "INR 259". */
export function readAmountPaise(raw: string): number | null {
  const m = /(\d[\d,]*(?:\.\d{1,2})?)/.exec(raw.replace(/(?:₹|rs\.?|inr)\s*/gi, ''))
  return m ? rupeeStringToPaise(m[1]) : null
}

export function readPaymentMode(raw: string): 'PREPAID' | 'COD' | 'INVOICE' | null {
  const v = raw.trim()
  const direct = normalisePaymentMode(v.replace(/\s+/g, '_'))
  if (direct) return direct
  if (/cash|cod|pay\s*on\s*delivery/i.test(v)) return 'COD'
  if (/prepaid|paid\s*online|online|upi|card/i.test(v)) return 'PREPAID'
  return null
}

const istIso = (y: number, mo: number, d: number, h: number, mi: number) =>
  `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:00+05:30`

/**
 * A date and time in IST, from the shapes aggregators send:
 * "05-Sep-2026 15:06", "25 Oct, 11:50 pm", "2026-09-25 21:16:00",
 * "31-08-2026, ETA: 14:10", "10/9/2026 & 12:50". A date without a year takes
 * the year nearest the email's arrival, like the built-in parsers.
 */
export function readDateTime(raw: string, receivedAt: Date, order: DateOrder = 'DMY'): Date | null {
  const v = raw.trim()
  const time = /(\d{1,2})[:.](\d{2})(?::\d{2})?\s*(am|pm)?/i.exec(v.replace(/^\d{4}-\d{1,2}-\d{1,2}/, '').replace(/^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}/, ''))
  let hour = time ? Number(time[1]) : null
  const minute = time ? Number(time[2]) : 0
  if (hour !== null && time?.[3]) {
    const pm = time[3].toLowerCase() === 'pm'
    if (hour === 12) hour = pm ? 12 : 0
    else if (pm) hour += 12
  }
  if (hour === null || hour > 23 || minute > 59) return null

  let y: number | null = null
  let mo: number | null = null
  let d: number | null = null
  const ymd = /(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/.exec(v)
  const named = /(\d{1,2})(?:st|nd|rd|th)?[\s\-,]+([A-Za-z]{3})[A-Za-z]*\.?[\s\-,]*(\d{4})?/.exec(v)
  const named2 = /([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?/.exec(v)
  const numeric = /(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/.exec(v)
  if (ymd) {
    y = Number(ymd[1]); mo = Number(ymd[2]) - 1; d = Number(ymd[3])
  } else if (named && MONTHS[named[2].toLowerCase()] !== undefined) {
    d = Number(named[1]); mo = MONTHS[named[2].toLowerCase()]; y = named[3] ? Number(named[3]) : null
  } else if (named2 && MONTHS[named2[1].toLowerCase()] !== undefined) {
    mo = MONTHS[named2[1].toLowerCase()]; d = Number(named2[2]); y = named2[3] ? Number(named2[3]) : null
  } else if (numeric) {
    const a = Number(numeric[1]); const b = Number(numeric[2])
    y = Number(numeric[3]); if (y < 100) y += 2000
    if (order === 'MDY') { mo = a - 1; d = b } else { d = a; mo = b - 1 }
  } else {
    return null
  }
  if (mo === null || d === null || mo < 0 || mo > 11 || d < 1 || d > 31) return null

  const build = (year: number) => {
    const t = new Date(istIso(year, mo!, d!, hour!, minute))
    return Number.isNaN(t.getTime()) ? null : t
  }
  if (y !== null) return build(y)
  const yr = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric' }).format(receivedAt))
  const cands = [build(yr - 1), build(yr), build(yr + 1)].filter((x): x is Date => x !== null)
  if (!cands.length) return null
  return cands.reduce((best, c) => (Math.abs(c.getTime() - receivedAt.getTime()) < Math.abs(best.getTime() - receivedAt.getTime()) ? c : best))
}

/** A dish quantity: "2", "x2", "×2", "Qty: 2". Defaults to 1 when absent. */
export function readQty(raw: string | null): number | null {
  if (raw === null) return 1
  const m = /(\d{1,4})/.exec(raw)
  if (!m) return null
  const n = Number(m[1])
  return n > 0 && n <= 5000 ? n : null
}
