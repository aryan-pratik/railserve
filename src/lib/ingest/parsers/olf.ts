import type { OrderParser, ParseResult, ParsedOrder } from '../types'
import { looksLikePhone, normalisePaymentMode, rupeeStringToPaise, stripEmoji } from './shared'

/**
 * OLF parser.
 *
 * A WhatsApp-forwarded message, not an email-style aggregator feed: labels are
 * wrapped in `*bold*` markers and prefixed with emoji, joined to their value
 * with `:-` rather than a plain colon. OLF has exactly one outlet — the
 * message carries no outlet name field at all, so `outletName` is fixed to
 * the vendor's own name and resolved the same way every other parser's
 * outlet name is: via matchOutlet against an active Restaurant/alias.
 *
 * Real sample:
 *   *OLF*
 *   You Recieved a new order from OLF.
 *   *✅IRCTC order ID* :- 2481128752
 *   *✅Customer Name* :- Arth Singh
 *   *📱Mobile No.* :- 7300972260
 *   *🚊Train Name & Number*:-  SFG MCTM SF EXP 22432
 *   *✅Coach & Birth No*:- M2 46
 *   *📅Delivery Date*:- 08-31-2026 09:55 IST
 *   *✅Delivery Station* :- KANPUR CENTRAL
 *   *✅Items* :- 1x Aloo Paratha With Curd Combo
 *   *✅Amount* :- Rs. 183 only
 *   *✅Payment Mode*:- CASH_ON_DELIVERY
 *   *❇️Customer Comment* :- N/A
 *
 * The vendor's own field name is "Birth No" — a typo for "Berth", kept as-is
 * in the regex below since it is what actually arrives.
 *
 * OLF gives only a station name, never a code. Extend this map as new
 * stations are seen; an unmapped station fails closed into MISSING_FIELD
 * rather than guessing a code (same rule matchOutlet applies to outlet names).
 */
const STATION_CODES: Record<string, string> = {
  'KANPUR CENTRAL': 'CNB',
  'PRAYAGRAJ JN': 'PRYJ',
}

export class OlfParser implements OrderParser {
  readonly source = 'OLF' as const

  matches(body: string): boolean {
    return /\bOLF\b/i.test(body) && /IRCTC\s*order\s*ID/i.test(body)
  }

  parse(body: string, _receivedAt: Date): ParseResult {
    const text = stripEmoji(body.replace(/\r\n/g, '\n').replace(/\*/g, ''))
    const partial: Partial<ParsedOrder> = { source: 'OLF', outletName: 'OLF' }

    const field = (labels: string[]): string | null => {
      for (const label of labels) {
        const re = new RegExp(`${label}\\s*[:\\-]+\\s*(.+)`, 'i')
        const m = re.exec(text)
        if (m) {
          const v = m[1].trim()
          if (v) return v
        }
      }
      return null
    }

    const orderId = field(['IRCTC\\s*order\\s*ID'])
    if (!orderId) {
      return { ok: false, reason: 'PARSE_FAILED', detail: 'no IRCTC order id found', partial }
    }
    partial.externalOrderId = orderId

    const stationRaw = field(['Delivery\\s*Station'])
    const stationCode = stationRaw ? STATION_CODES[stationRaw.trim().toUpperCase()] : undefined
    if (!stationRaw || !stationCode) {
      return {
        ok: false, reason: 'MISSING_FIELD',
        detail: `station ${JSON.stringify(stationRaw)} has no known code — add it to STATION_CODES`,
        partial,
      }
    }
    partial.stationName = stationRaw.trim()
    partial.stationCode = stationCode

    const trainRaw = field(['Train\\s*Name\\s*&\\s*Number'])
    const trainMatch = trainRaw ? /^(.*?)\s+(\d{4,5})$/.exec(trainRaw) : null
    const trainName = trainMatch?.[1]?.trim() || null
    const trainNo = trainMatch?.[2] ?? null

    const seatRaw = field(['Coach\\s*&\\s*Birth\\s*No'])
    const rawSeat = seatRaw ? seatRaw.toUpperCase() : null
    const seatMatch = rawSeat ? /^(\S+)\s+(\d+)$/.exec(rawSeat) : null
    const coach = seatMatch?.[1] ?? rawSeat
    const berth = seatMatch?.[2] ?? null

    const phoneRaw = field(['Mobile\\s*No\\.?'])
    const contactPhone =
      phoneRaw && looksLikePhone(phoneRaw) ? phoneRaw.replace(/\D/g, '').slice(-10) : null
    const contactName = field(['Customer\\s*Name'])

    const dateRaw = field(['Delivery\\s*Date'])
    const dateMatch = dateRaw
      ? /(\d{2})-(\d{2})-(\d{4})\s+(\d{1,2}):(\d{2})/.exec(dateRaw)
      : null
    const scheduledArrival = dateMatch
      ? new Date(
          `${dateMatch[3]}-${dateMatch[1]}-${dateMatch[2]}T` +
            `${dateMatch[4].padStart(2, '0')}:${dateMatch[5]}:00+05:30`,
        )
      : null

    const itemsRaw = field(['Items'])
    const itemMatch = itemsRaw ? /^(\d+)\s*[xX]\s*(.+)$/.exec(itemsRaw.trim()) : null
    if (!itemMatch) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'no order items found', partial }
    }
    const commentRaw = field(['Customer\\s*Comment'])
    const comment = commentRaw && !/^N\/?A$/i.test(commentRaw.trim()) ? commentRaw.trim() : null
    const items = [{ name: itemMatch[2].trim(), qty: Number(itemMatch[1]), notes: comment }]

    const amountRaw = field(['Amount'])
    const amountMatch = amountRaw ? /([\d,]+(?:\.\d+)?)/.exec(amountRaw) : null
    const amountPaise = amountMatch ? rupeeStringToPaise(amountMatch[1]) : null
    if (amountPaise === null) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'amount missing or unparseable', partial }
    }

    const payRaw = field(['Payment\\s*Mode'])
    const paymentMode = payRaw ? normalisePaymentMode(payRaw) : null

    return {
      ok: true,
      order: {
        source: 'OLF',
        externalOrderId: orderId,
        outletName: 'OLF',
        stationName: partial.stationName ?? null,
        stationCode,
        contactName,
        contactPhone,
        trainNo,
        trainName,
        coach,
        berth,
        rawSeat,
        scheduledArrival,
        items,
        amountPaise,
        paymentMode,
      },
    }
  }
}
