import type { OrderParser, ParseResult, ParsedOrder } from '../types'
import {
  looksLikePhone, normalisePaymentMode, parseAggregatorDate, rupeeStringToPaise, stripEmoji,
} from './shared'

/**
 * YatriRestro order confirmation parser. Plan §6.
 *
 * Deterministic and total: it either returns a complete order or says exactly
 * why it could not. Plan §6 is emphatic that a partial order must never be
 * inserted — a missing field lands in the unparsed inbox instead, because an
 * order missing a seat is worse than an order a human has to look at.
 */
export class YatriRestroParser implements OrderParser {
  readonly source = 'YATRIRESTRO' as const

  matches(body: string): boolean {
    // A bare substring check for "YatriRestro" also fires on the vendor's own
    // email domain — "support@yatrirestro.com" — which shows up in the OTHER
    // YatriRestro template (the "Order Booking Confirmation" table format,
    // see YatriRestroBookingParser) whenever that email gets Gmail-forwarded.
    // Since parsers are tried in order and both share source YATRIRESTRO, that
    // false match would swallow the booking-confirmation email here, fail to
    // parse it (no "Order Id" line), and never let the other parser see it.
    // Excluding an immediately-preceding "@" or trailing "." keeps the loose
    // fallback for genuine mentions without matching the domain.
    return (
      /Order\s*From\s*YatriRestro/i.test(body) ||
      /(?<![\w@.])YatriRestro(?![\w.])/i.test(body)
    )
  }

  parse(body: string, receivedAt: Date): ParseResult {
    const text = body.replace(/\r\n/g, '\n')
    const partial: Partial<ParsedOrder> = { source: 'YATRIRESTRO' }

    const orderId = /Order\s*Id\s*:?\s*#?(\d+)/i.exec(text)?.[1] ?? null
    if (!orderId) {
      return { ok: false, reason: 'PARSE_FAILED', detail: 'no order id found', partial }
    }
    partial.externalOrderId = orderId

    const outletName = /Outlet\s*Name\s*-\s*(.+)/i.exec(text)?.[1]?.trim() ?? null
    if (!outletName) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'outlet name missing', partial }
    }
    partial.outletName = outletName

    // "KANPUR CENTRAL-CNB" — the code is the FINAL hyphen segment, because
    // station names contain hyphens of their own.
    const stationLine = /Station\s*Code\/Name\s*-\s*(.+)/i.exec(text)?.[1]?.trim() ?? null
    const stationMatch = stationLine ? /^(.*)-([A-Z]{2,5})$/.exec(stationLine) : null
    if (!stationMatch) {
      return {
        ok: false, reason: 'MISSING_FIELD',
        detail: `station code not parseable from ${JSON.stringify(stationLine)}`, partial,
      }
    }
    partial.stationName = stationMatch[1].trim() || null
    partial.stationCode = stationMatch[2].trim().toUpperCase()

    // --- delivery line ---------------------------------------------------
    // Name | phone | train | seat | time, each optionally emoji-prefixed.
    // Identify by shape first and fall back to position, so a stripped-emoji
    // copy-paste still parses.
    const deliveryLine = this.findDeliveryLine(text)
    if (!deliveryLine) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'delivery details line missing', partial }
    }

    const parts = deliveryLine.split('|').map((p) => stripEmoji(p)).filter((p) => p.length > 0)

    let contactName: string | null = null
    let contactPhone: string | null = null
    let trainNo: string | null = null
    let trainName: string | null = null
    let rawSeat: string | null = null
    let timeRaw: string | null = null

    // Pass 1 — identify by shape. Robust to the aggregator reordering fields,
    // which it has no contract not to do.
    const consumed = new Set<number>()
    parts.forEach((part, i) => {
      const trainMatch = /^(\d{5})\s*-\s*(.+)$/.exec(part)
      if (trainMatch && !trainNo) {
        trainNo = trainMatch[1]
        trainName = trainMatch[2].trim()
        consumed.add(i)
        return
      }
      if (/^[A-Z]+\d*\s*-\s*\d+$/i.test(part) && !rawSeat) {
        rawSeat = part.replace(/\s*-\s*/, '-').toUpperCase()
        consumed.add(i)
        return
      }
      if (/\d{1,2}[-\s][A-Za-z]{3}/.test(part) && /\d{1,2}:\d{2}/.test(part) && !timeRaw) {
        timeRaw = part
        consumed.add(i)
        return
      }
      if (looksLikePhone(part) && !/[A-Za-z]/.test(part) && !contactPhone) {
        contactPhone = part.replace(/\D/g, '').slice(-10)
        consumed.add(i)
      }
    })

    // Pass 2 — positional fallback (plan §6). The line is
    // name | phone | train | seat | time, and a value that matches no shape —
    // a bare coach class like GEN, say — is still recoverable from where it sits.
    const POSITION = { name: 0, phone: 1, train: 2, seat: 3, time: 4 } as const
    const takeAt = (i: number): string | null =>
      !consumed.has(i) && parts[i] ? (consumed.add(i), parts[i]) : null

    if (!rawSeat) {
      const v = takeAt(POSITION.seat)
      if (v) rawSeat = v.toUpperCase()
    }
    if (!contactPhone) {
      const v = takeAt(POSITION.phone)
      if (v && looksLikePhone(v)) contactPhone = v.replace(/\D/g, '').slice(-10)
    }

    contactName =
      takeAt(POSITION.name) ??
      parts.find((p, i) => !consumed.has(i) && /[A-Za-z]{2,}/.test(p)) ??
      null

    // A coach with no berth is a real variant (§6 edge cases); keep rawSeat
    // regardless of whether it splits.
    let coach: string | null = null
    let berth: string | null = null
    if (rawSeat) {
      const seatMatch = /^([A-Z]+\d*)-(\d+)$/.exec(rawSeat)
      if (seatMatch) {
        coach = seatMatch[1]
        berth = seatMatch[2]
      } else {
        coach = rawSeat
      }
    }

    const scheduledArrival = timeRaw ? parseAggregatorDate(timeRaw, receivedAt) : null

    // --- items -----------------------------------------------------------
    const items = this.parseItems(text)
    if (items.length === 0) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'no order items found', partial }
    }

    // --- amount ----------------------------------------------------------
    const amountMatch = /Amount\s*-\s*([\d.,]+)\s*-\s*(\w+)/i.exec(text)
    const amountPaise = amountMatch ? rupeeStringToPaise(amountMatch[1]) : null
    const paymentMode = amountMatch ? normalisePaymentMode(amountMatch[2]) : null

    if (amountPaise === null) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'amount missing or unparseable', partial }
    }

    const order: ParsedOrder = {
      source: 'YATRIRESTRO',
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
    }

    return { ok: true, order }
  }

  /** The line after the *Delivery Details* header, or the first pipe-rich line. */
  private findDeliveryLine(text: string): string | null {
    const lines = text.split('\n').map((l) => l.trim())
    const headerIdx = lines.findIndex((l) => /Delivery\s*Details/i.test(l))

    if (headerIdx >= 0) {
      for (let i = headerIdx + 1; i < lines.length; i++) {
        const l = lines[i]
        if (/^-{3,}$/.test(l) || l === '') continue
        if (l.includes('|')) return l
        break
      }
    }
    return lines.find((l) => (l.match(/\|/g)?.length ?? 0) >= 2) ?? null
  }

  /**
   * Every non-empty line between *Order Items* and the next divider.
   * Plan §6: "Loop — do not match once." A real order has several lines and
   * matching once silently drops the rest.
   */
  private parseItems(text: string): { name: string; qty: number; notes: string | null }[] {
    const lines = text.split('\n').map((l) => l.trim())
    const start = lines.findIndex((l) => /^\*?\s*Order\s*Items\s*\*?$/i.test(l))
    if (start < 0) return []

    const items: { name: string; qty: number; notes: string | null }[] = []

    for (let i = start + 1; i < lines.length; i++) {
      const line = lines[i]
      if (/^-{3,}$/.test(line)) break
      if (!line) continue

      // One line can carry several items — "Aalu Paratha - 1 | Paneer Paratha
      // - 2 |" is a single order of three dishes. Split on the pipe and judge
      // each segment by shape: "name - qty" opens a new item, anything else is
      // a note on the item before it ("Masala Chai - 3 | extra sugar").
      // Matching the line once instead would silently fold the second dish
      // into the first one's notes and under-count the order.
      for (const segment of line.split('|')) {
        const part = segment.trim()
        if (!part) continue

        const m = /^(.+?)\s*-\s*(\d+)$/.exec(part)
        if (m) {
          items.push({ name: m[1].trim(), qty: Number(m[2]), notes: null })
        } else if (items.length > 0) {
          const prev = items[items.length - 1]
          prev.notes = prev.notes ? `${prev.notes} ${part}` : part
        }
      }
    }

    return items
  }
}
