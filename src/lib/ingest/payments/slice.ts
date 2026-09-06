import { MONTHS, rupeeStringToPaise } from '../parsers/shared'
import type { PaymentParseResult, PaymentParser, ParsedPayment } from './types'

/**
 * slice bank credit alerts:
 *
 *   Hi Gautam,
 *     You have received ₹230 via UPI in your slice bank account xx8773.
 *     Avl. Bal. ₹3,571.23
 *        Transaction date   06-Sep-26
 *     From    AMITKUMAR TIWARI
 *     RRN     661533935455
 *
 *     Best,
 *    Team slice
 *
 * Sent as HTML, so what actually reaches this parser is the tag-stripped text
 * from extractBody() — which keeps the <style> block's CSS as leading noise
 * and turns table cells into tabs. Every field is therefore read off its own
 * label rather than by position, and label and value may be separated by a
 * colon, a tab, or a run of spaces depending on how the mail was laid out.
 *
 * Debit alerts are deliberately NOT matched. This parser answers one question
 * — did money arrive, and from whom — and a debit has no payer to put in the
 * From column. Anything else slice sends still goes down the normal path and
 * lands in the unparsed inbox, where a template change is supposed to show up.
 */

/** Label/value separator: a colon, a tab, or two or more spaces. */
const SEP = '(?:[ \\t]*:[ \\t]*|[ \\t]{2,})'
/** ₹, Rs, Rs., INR — or nothing at all, if the rupee sign was stripped. */
const CURRENCY = '(?:₹|Rs\\.?|INR)?\\s*'

const RECEIVED_RE = new RegExp(`you\\s+have\\s+received\\s*${CURRENCY}([\\d,]+(?:\\.\\d{1,2})?)`, 'i')
const BALANCE_RE = new RegExp(`Avl\\.?\\s*Bal(?:ance)?\\.?\\s*${CURRENCY}([\\d,]+(?:\\.\\d{1,2})?)`, 'i')
const METHOD_RE = /received[^\n]*?\bvia\s+([A-Za-z]{2,12})\b/i
const ACCOUNT_RE = /\baccount\s+[xX*]{0,6}(\d{3,6})\b/
const TXN_DATE_RE = new RegExp(
  `Transaction\\s*date${SEP}?\\s*(\\d{1,2})[-\\s]([A-Za-z]{3})[A-Za-z]*[-\\s](\\d{2}|\\d{4})`,
  'i',
)
const RRN_RE = new RegExp(`(?:^|\\n)[^\\S\\n]*RRN${SEP}([A-Za-z0-9-]{6,})`, 'i')
/** Global — every "From" line is a candidate; see pickPayerName(). */
const FROM_RE = new RegExp(`(?:^|\\n)[^\\S\\n]*From${SEP}([^\\n]+)`, 'gi')

export class SlicePaymentParser implements PaymentParser {
  readonly provider = 'SLICE' as const

  matches(body: string): boolean {
    return (
      /\bslice\b/i.test(body) &&
      RECEIVED_RE.test(body) &&
      /\b(?:bank\s+)?account\b/i.test(body)
    )
  }

  parse(body: string, receivedAt: Date): PaymentParseResult {
    const text = body.replace(/\r\n/g, '\n')
    const partial: Partial<ParsedPayment> = { provider: 'SLICE' }

    const amountPaise = money(RECEIVED_RE.exec(text)?.[1])
    if (amountPaise === null) {
      return { ok: false, reason: 'PARSE_FAILED', detail: 'no credited amount found', partial }
    }
    partial.amountPaise = amountPaise

    // The dedupe key. Without it the same alert, replayed by a history sync or
    // re-pasted by hand, would become a second row — so a missing RRN is a
    // hard failure that belongs in front of a human, not a row we invent an
    // id for.
    const rrn = RRN_RE.exec(text)?.[1]?.trim() ?? null
    if (!rrn) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'no RRN found', partial }
    }
    partial.rrn = rrn

    const payerName = pickPayerName(text)
    if (!payerName) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'no payer name found', partial }
    }
    partial.payerName = payerName

    const transactionDate = parseAlertDate(text, receivedAt)
    if (!transactionDate) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'no transaction date found', partial }
    }
    partial.transactionDate = transactionDate

    const method = METHOD_RE.exec(text)?.[1]?.toUpperCase() ?? null
    const accountLast4 = ACCOUNT_RE.exec(text)?.[1]?.slice(-4) ?? null
    // Optional on purpose: an alert that stops quoting the balance should
    // still record the money, with a blank balance rather than no payment.
    const availableBalancePaise = money(BALANCE_RE.exec(text)?.[1])

    return {
      ok: true,
      payment: {
        provider: 'SLICE',
        payerName,
        amountPaise,
        rrn,
        method,
        accountLast4,
        transactionDate,
        availableBalancePaise,
      },
    }
  }
}

/**
 * A captured rupee string to paise, treating "no match" as null.
 *
 * rupeeStringToPaise('') is 0, not null — Number('') is 0 — so passing an
 * absent capture straight through would record a real ₹0 balance rather than
 * an unknown one.
 */
function money(raw: string | undefined): number | null {
  if (!raw) return null
  return rupeeStringToPaise(raw)
}

/**
 * The payer, off the "From" line.
 *
 * A forwarded or pasted mail carries the envelope's own `From:` header too,
 * so the first match is not reliably the one that means "who paid". Anything
 * that looks like an email address or an angle-bracketed sender is skipped in
 * favour of the next candidate — a payer name never contains either.
 */
function pickPayerName(text: string): string | null {
  FROM_RE.lastIndex = 0
  for (const m of text.matchAll(FROM_RE)) {
    const value = m[1].trim().replace(/[.,;]+$/, '')
    if (!value) continue
    if (value.includes('@') || value.includes('<')) continue
    return value
  }
  return null
}

/**
 * "06-Sep-26" to '2026-09-06'.
 *
 * Returned as a plain IST calendar string, never a Date — the alert prints a
 * date with no time, and giving it a midnight timestamp would put it on the
 * previous day for anything reading it in UTC.
 *
 * The two-digit year takes its century from the email's own timestamp, so
 * these keep working in 2100 and, more usefully, a backfill of old mail does
 * not silently land a decade out.
 */
function parseAlertDate(text: string, receivedAt: Date): string | null {
  const m = TXN_DATE_RE.exec(text)
  if (!m) return null

  const day = Number(m[1])
  const month = MONTHS[m[2].toLowerCase()]
  if (month === undefined || day < 1 || day > 31) return null

  const rawYear = Number(m[3])
  const receivedYearIST = Number(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric' }).format(receivedAt),
  )
  const year = m[3].length === 4 ? rawYear : Math.floor(receivedYearIST / 100) * 100 + rawYear

  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
