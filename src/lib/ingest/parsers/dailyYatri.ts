import type { OrderParser, ParseResult, ParsedOrder } from '../types'
import {
  looksLikePhone, normalisePaymentMode, parseAggregatorDate, rupeeStringToPaise, stripEmoji,
} from './shared'

/**
 * DailyYatri parser. Plan §6: "DailyYatri gets its own parser module behind the
 * same OrderParser interface. Do not try to write one parser for both."
 *
 * ⚠️  NO REAL SAMPLE WAS AVAILABLE when this was written. The plan supplies a
 * worked example for YatriRestro only. This implements the label-and-colon
 * layout these aggregators generally use, and every test fixture for it is
 * therefore invented rather than observed.
 *
 * Treat it as a scaffold: when a real DailyYatri email arrives it will very
 * likely fail into the unparsed inbox, which is exactly the designed behaviour
 * — nothing here can silently route an order to the wrong kitchen. Replace the
 * field regexes below against a real sample before relying on it.
 */
export class DailyYatriParser implements OrderParser {
  readonly source = 'DAILYYATRI' as const

  matches(body: string): boolean {
    return /DailyYatri/i.test(body)
  }

  parse(body: string, receivedAt: Date): ParseResult {
    const text = body.replace(/\r\n/g, '\n')
    const partial: Partial<ParsedOrder> = { source: 'DAILYYATRI' }

    const field = (labels: string[]): string | null => {
      for (const label of labels) {
        const re = new RegExp(`${label}\\s*[:\\-]\\s*(.+)`, 'i')
        const m = re.exec(text)
        if (m) {
          const v = stripEmoji(m[1]).trim()
          if (v) return v
        }
      }
      return null
    }

    const orderId = (field(['Order\\s*(?:ID|No\\.?|Number)']) ?? '').replace(/^#/, '') || null
    if (!orderId) {
      return { ok: false, reason: 'PARSE_FAILED', detail: 'no order id found', partial }
    }
    partial.externalOrderId = orderId

    const outletName = field(['Outlet|Restaurant|Vendor'])
    if (!outletName) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'outlet name missing', partial }
    }
    partial.outletName = outletName

    const stationRaw = field(['Station'])
    const stationMatch = stationRaw ? /^(.*?)[-(\s]*\(?([A-Z]{2,5})\)?$/.exec(stationRaw) : null
    if (!stationMatch) {
      return {
        ok: false, reason: 'MISSING_FIELD',
        detail: `station code not parseable from ${JSON.stringify(stationRaw)}`, partial,
      }
    }
    partial.stationName = stationMatch[1].trim().replace(/[-–]$/, '').trim() || null
    partial.stationCode = stationMatch[2].toUpperCase()

    const trainRaw = field(['Train'])
    const trainMatch = trainRaw ? /^(\d{4,5})\s*[-–/]?\s*(.*)$/.exec(trainRaw) : null
    const trainNo = trainMatch?.[1] ?? null
    const trainName = trainMatch?.[2]?.trim() || null

    const seatRaw = field(['Seat|Berth|Coach'])
    const rawSeat = seatRaw ? seatRaw.toUpperCase() : null
    const seatMatch = rawSeat ? /^([A-Z]+\d*)\s*[-/]\s*(\d+)$/.exec(rawSeat) : null
    const coach = seatMatch?.[1] ?? rawSeat
    const berth = seatMatch?.[2] ?? null

    const phoneRaw = field(['Mobile|Phone|Contact\\s*No'])
    const contactPhone =
      phoneRaw && looksLikePhone(phoneRaw) ? phoneRaw.replace(/\D/g, '').slice(-10) : null
    const contactName = field(['Passenger|Customer|Name'])

    const timeRaw = field(['Delivery\\s*Time|Arrival|ETA'])
    const scheduledArrival = timeRaw ? parseAggregatorDate(timeRaw, receivedAt) : null

    const items = this.parseItems(text)
    if (items.length === 0) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'no order items found', partial }
    }

    const amountRaw = field(['Total|Amount|Grand\\s*Total'])
    const amountMatch = amountRaw ? /([\d.,]+)/.exec(amountRaw) : null
    const amountPaise = amountMatch ? rupeeStringToPaise(amountMatch[1]) : null
    if (amountPaise === null) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'amount missing or unparseable', partial }
    }

    const payRaw = field(['Payment|Payment\\s*Mode|Mode'])
    const paymentMode = payRaw ? normalisePaymentMode(payRaw) : null

    return {
      ok: true,
      order: {
        source: 'DAILYYATRI',
        externalOrderId: orderId,
        outletName,
        stationName: partial.stationName ?? null,
        stationCode: partial.stationCode!,
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

  /** Items between an "Items"/"Order Details" header and the next divider. */
  private parseItems(text: string): { name: string; qty: number; notes: string | null }[] {
    const lines = text.split('\n').map((l) => l.trim())
    const start = lines.findIndex((l) => /^\*?\s*(Order\s*)?(Items|Order\s*Details)\s*\*?:?\s*$/i.test(l))
    if (start < 0) return []

    const items: { name: string; qty: number; notes: string | null }[] = []
    for (let i = start + 1; i < lines.length; i++) {
      const line = lines[i]
      if (/^[-=_]{3,}$/.test(line)) break
      if (!line) continue

      // "Veg Thali x 2" or "Veg Thali - 2"
      const m = /^(.+?)\s*(?:x|X|-|–)\s*(\d+)\s*(?:\|(.*))?$/.exec(line)
      if (!m) continue
      const notes = m[3]?.trim()
      items.push({ name: m[1].trim(), qty: Number(m[2]), notes: notes || null })
    }
    return items
  }
}
