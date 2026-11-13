import type { OrderParser, ParseResult, ParsedOrder } from '../types'
import { looksLikePhone, normalisePaymentMode, rupeeStringToPaise, stationCodeForName } from './shared'

/**
 * "New Order Notification" parser. A plain-text message, WhatsApp-style bold
 * markers around every value, arriving both by mail and pasted from a phone:
 *
 *   New Order Notification
 *
 *   Order Details:
 *   - IRCTC Order ID: *2504099482*
 *   - Name: *Jitu Singh *
 *   - Phone: 9718847329
 *   - Payment Type: *PRE_PAID*
 *   - Train: *05094/HDP GKP SPECIAL*
 *   - Station: *KANPUR CENTRAL*
 *   - Arrival Time: *15:21*
 *   - Arrival Date: *13-11-2026*
 *   - Coach & Seat: *A2* / *39*   (sent with no spaces around the slash)
 *
 *   Menu Items:
 *   *1 x PANEER CURRY WITH ROTI COMBO (Veg),*
 *
 *   Order Total: ₹*197*
 *   Amount to Collect: ₹*0*
 *
 *   Customer Note: *Provide Good Food*
 *
 *   This is an automated notification.
 *
 * The message names neither the vendor nor the outlet, so — like
 * FoodOnTrains and HomeBytes — every order is filed under one fixed outlet
 * name and routed through the station: a Listing for "Order Notification"
 * can map it to a kitchen in Setup → Aggregators. It is recognised by shape
 * alone, so it sits near the end of PARSERS, behind every parser that keys on
 * a vendor's name.
 *
 * Only the station's name is sent, never its code; it is looked up in the
 * shared STATION_CODES table and fails closed when missing, as OLF does.
 *
 * "Amount to Collect" decides cash on delivery: above zero is cash the rider
 * comes back with. "Payment Type" says the same thing and is only the
 * fallback, as with RailRestro and RelFood.
 *
 * The body can arrive with "&" still escaped as "&amp;" (a pasted HTML view,
 * or a mail part gmail/client.ts did not flatten), so entities are decoded
 * before anything is read.
 */
type Item = ParsedOrder['items'][number]

export const ORDER_NOTIFICATION_OUTLET = 'Order Notification'

function clean(body: string): string {
  return body
    .replace(/\r\n/g, '\n')
    .replace(/&amp;/gi, '&')
    .replace(/&#8377;|&#x0*20b9;/gi, '₹')
    .replace(/&times;|&#215;|&#x0*d7;/gi, '×')
    .replace(/&nbsp;| /g, ' ')
    // WhatsApp's bold markers wrap values, and sometimes half a value
    // ("*A2*" and "*39*" either side of the seat's slash); none of them is ever part of the data.
    .replace(/\*/g, '')
}

/** An IST wall-clock time as an instant. `month` is 1-12. */
function istDate(year: number, month: number, day: number, hour: number, minute: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  const d = new Date(`${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00+05:30`)
  return Number.isNaN(d.getTime()) ? null : d
}

function parseRupees(raw: string | null): number | null {
  const m = raw ? /[\d,]+(?:\.\d+)?/.exec(raw) : null
  return m ? rupeeStringToPaise(m[0]) : null
}

export class OrderNotificationParser implements OrderParser {
  readonly source = 'NOTIFICATION' as const

  matches(body: string): boolean {
    const text = clean(body)
    return (
      /^[ \t]*New\s+Order\s+Notification\b/im.test(text) &&
      /IRCTC\s+Order\s+ID\s*:/i.test(text) &&
      /^[ \t]*Menu\s+Items\s*:/im.test(text)
    )
  }

  parse(body: string, _receivedAt: Date): ParseResult {
    const text = clean(body)
    const partial: Partial<ParsedOrder> = {
      source: 'NOTIFICATION',
      outletName: ORDER_NOTIFICATION_OUTLET,
    }

    // "- Label: value", the bullet optional: a mail flattened from an HTML
    // list loses it, and a label is at the start of its line either way.
    const field = (label: string): string | null => {
      const re = new RegExp(`^[ \\t]*(?:[-•][ \\t]*)?${label}[ \\t]*:[ \\t]*(.*)$`, 'im')
      const v = re.exec(text)?.[1]?.replace(/\s+/g, ' ').trim()
      return v || null
    }

    const externalOrderId = /\d+/.exec(field('IRCTC\\s+Order\\s+ID') ?? '')?.[0]
    if (!externalOrderId) {
      return { ok: false, reason: 'PARSE_FAILED', detail: 'no IRCTC order id found', partial }
    }
    partial.externalOrderId = externalOrderId

    const stationName = field('Station')
    const stationCode = stationCodeForName(stationName)
    if (!stationName || !stationCode) {
      return {
        ok: false, reason: 'MISSING_FIELD',
        detail: `station ${JSON.stringify(stationName)} has no known code: add it to STATION_CODES`,
        partial,
      }
    }
    partial.stationName = stationName
    partial.stationCode = stationCode

    // "05094/HDP GKP SPECIAL"
    const trainMatch = /^(\d{3,5})\s*(?:[/-]\s*(.+))?$/.exec(field('Train') ?? '')
    const trainNo = trainMatch?.[1] ?? null
    const trainName = trainMatch?.[2]?.trim() || null

    // "A2/39" once the bold markers are gone. Split on the last slash.
    const seatMatch = /^(.+?)\s*\/\s*([^/\s]+)$/.exec(field('Coach\\s*(?:&|and)\\s*Seat') ?? '')
    const coach = seatMatch?.[1]?.trim().toUpperCase() || null
    const berth = seatMatch?.[2] ?? null
    const rawSeat = coach && berth ? `${coach}-${berth}` : null

    const contactName = field('Name')
    const phoneRaw = field('Phone')
    const contactPhone = phoneRaw && looksLikePhone(phoneRaw) ? phoneRaw.replace(/\D/g, '').slice(-10) : null

    // Date and time are separate lines: "13-11-2026" (DD-MM-YYYY) and "15:21".
    const dateMatch = /(\d{1,2})-(\d{1,2})-(\d{4})/.exec(field('Arrival\\s+Date') ?? '')
    const timeMatch = /(\d{1,2}):(\d{2})/.exec(field('Arrival\\s+Time') ?? '')
    const scheduledArrival =
      dateMatch && timeMatch
        ? istDate(
            Number(dateMatch[3]), Number(dateMatch[2]), Number(dateMatch[1]),
            Number(timeMatch[1]), Number(timeMatch[2]),
          )
        : null

    const items = this.parseItems(text)
    if (items.length === 0) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'no order items found', partial }
    }
    // One note for the whole order and none per item; the first item carries
    // it, so it reaches the kitchen ticket.
    const note = field('Customer\\s+Note')
    if (note && !/^(?:N\/?A|NIL|NONE|-)$/i.test(note)) items[0].notes = note

    const amountPaise = parseRupees(field('Order\\s+Total'))
    if (amountPaise === null) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'order total missing or unparseable', partial }
    }

    const duePaise = parseRupees(field('Amount\\s+to\\s+Collect'))
    const payRaw = field('Payment\\s+Type')
    const paymentMode: ParsedOrder['paymentMode'] =
      duePaise !== null
        ? duePaise > 0 ? 'COD' : 'PREPAID'
        : payRaw ? normalisePaymentMode(payRaw.replace(/\s+/g, '_')) : null

    return {
      ok: true,
      order: {
        source: 'NOTIFICATION',
        externalOrderId,
        outletName: ORDER_NOTIFICATION_OUTLET,
        stationName,
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

  /**
   * "1 x PANEER CURRY WITH ROTI COMBO (Veg)," — one per line between "Menu
   * Items:" and "Order Total:", each with a trailing comma. Several on one
   * line are split at the comma before the next "<n> x".
   */
  private parseItems(text: string): Item[] {
    const start = /^[ \t]*Menu\s+Items\s*:/im.exec(text)
    if (!start) return []
    const rest = text.slice(start.index + start[0].length)
    const end = /^[ \t]*(?:Order\s+Total|Amount\s+to\s+Collect|Customer\s+Note)\s*:/im.exec(rest)
    const block = end ? rest.slice(0, end.index) : rest

    const items: Item[] = []
    for (const line of block.split('\n')) {
      for (const chunk of line.split(/,\s*(?=\d+\s*[x×]\s)/i)) {
        const m = /^[-•\s]*(\d+)\s*[x×]\s*(.+?)[\s,.;]*$/i.exec(chunk.trim())
        const qty = m ? Number(m[1]) : 0
        const name = m?.[2]?.replace(/\s+/g, ' ').trim()
        if (m && qty > 0 && name) items.push({ name, qty, notes: null })
      }
    }
    return items
  }
}
