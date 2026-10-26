import type { OrderParser, ParseResult, ParsedOrder } from '../types'
import { looksLikePhone, parseAggregatorDate, rupeeStringToPaise } from './shared'

/**
 * FoodOnTrains parser. A "New order" mail with one label/value pair per line
 * — tabs between them once gmail/client.ts has flattened the HTML, runs of
 * spaces when it is pasted from a rendered view:
 *
 *   foodontrains
 *   New order FT-577998
 *   Test · please have it ready before the train arrives
 *
 *   Items    2 × veg pizza 1 ₹420
 *   1 × veg thali 1 ₹200
 *   Station    Kanpur Central (CNB)
 *   Train    02564 NDLS BJU SPL
 *   Expected arrival    25 Oct, 11:50 pm
 *   Coach and seat    VA, seat 34
 *   Payment    Collect ₹651 in cash at the seat
 *   Passenger    Gautam, 9821244895
 *   Order total    ₹651 (items ₹620 + GST ₹31)
 *   foodontrains.in · Food at your train seat
 *
 * The first item rides on the "Items" label line and the rest follow on
 * lines of their own, so items are read from the whole block up to the
 * "Station" label rather than line by line. Each row's price is the line
 * total (2 × … ₹420), and nothing here needs it.
 *
 * The id keeps its "FT-" prefix: it is what the restaurant sees in the mail,
 * and it cannot collide with another aggregator's bare numeric ids.
 *
 * The arrival carries no year and a 12-hour clock; it is rewritten to the
 * "25 Oct 23:50" shape parseAggregatorDate already reads, so it gets the
 * same year inference as every other year-less aggregator date.
 *
 * The mail names no outlet. The line under the id ("Test · please have it
 * ready…") could be the restaurant's name or a customer note, and reading a
 * note as an outlet would file a junk storefront per order. A fixed name, as
 * for HomeBytes and RajBhog, routes through the station instead, and a
 * Listing for "FoodOnTrains" can map it to a kitchen in Setup.
 */
type Item = ParsedOrder['items'][number]

const LABELS = [
  'Items',
  'Station',
  'Train',
  'Expected arrival',
  'Coach and seat',
  'Payment',
  'Passenger',
  'Order total',
]

/**
 * gmail/client.ts decodes only &nbsp; &amp; &lt; &gt;, so any other entity
 * the HTML used for ×, ₹ or · would still be sitting in the body.
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&times;|&#215;|&#x0*d7;/gi, '×')
    .replace(/&#8377;|&#x0*20b9;/gi, '₹')
    .replace(/&middot;|&#183;|&#x0*b7;/gi, '·')
    .replace(/&nbsp;|\u00a0/g, ' ')
}

export class FoodOnTrainsParser implements OrderParser {
  readonly source = 'FOODONTRAINS' as const

  matches(body: string): boolean {
    return /foodontrains/i.test(body) && /\bNew order\s+FT-\d+/i.test(body)
  }

  parse(body: string, receivedAt: Date): ParseResult {
    const text = decodeEntities(body.replace(/\r\n/g, '\n'))
    const partial: Partial<ParsedOrder> = { source: 'FOODONTRAINS', outletName: 'FoodOnTrains' }

    const idMatch = /\bNew order\s+(FT-\d+)/i.exec(text)
    if (!idMatch) {
      return { ok: false, reason: 'PARSE_FAILED', detail: 'no FT- order id found', partial }
    }
    const orderId = idMatch[1].toUpperCase()
    partial.externalOrderId = orderId

    // A label at the start of a line, then a tab, a run of spaces or a colon.
    const field = (label: string): string | null => {
      const re = new RegExp(`^[ \\t]*${label.replace(/ /g, '\\s+')}(?:[ \\t]*:[ \\t]*|\\t+[ \\t]*|[ ]{2,})(.+)$`, 'im')
      const v = re.exec(text)?.[1]?.trim()
      return v || null
    }

    const stationMatch = /^(.+?)\s*\(([A-Za-z]{2,5})\)\s*$/.exec(field('Station') ?? '')
    if (!stationMatch) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'station missing', partial }
    }
    const stationName = stationMatch[1].trim()
    const stationCode = stationMatch[2].toUpperCase()
    partial.stationName = stationName
    partial.stationCode = stationCode

    const items = this.parseItems(text)
    if (items.length === 0) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'no order items found', partial }
    }

    const totalMatch = /₹\s*([\d,]+(?:\.\d+)?)/.exec(field('Order total') ?? '')
    const amountPaise = totalMatch ? rupeeStringToPaise(totalMatch[1]) : null
    if (amountPaise === null) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'order total missing or unparseable', partial }
    }

    const trainMatch = /^(\d{4,5})\s*(.*)$/.exec(field('Train') ?? '')
    const trainNo = trainMatch?.[1] ?? null
    const trainName = trainMatch?.[2]?.trim() || null

    // "VA, seat 34"
    const seatMatch = /^([A-Za-z0-9/]+)\s*,?\s*(?:seat|berth)?\s*(\w+)?/i.exec(field('Coach\\s+and\\s+seat') ?? '')
    const coach = seatMatch?.[1]?.toUpperCase() ?? null
    const berth = seatMatch?.[2] ?? null
    const rawSeat = coach && berth ? `${coach}-${berth}` : coach

    // "Gautam, 9821244895" — split on the last comma, so a name with one
    // in it stays whole.
    const passenger = field('Passenger')
    let contactName: string | null = passenger
    let contactPhone: string | null = null
    const comma = passenger?.lastIndexOf(',') ?? -1
    if (passenger && comma >= 0 && looksLikePhone(passenger.slice(comma + 1))) {
      contactName = passenger.slice(0, comma).trim() || null
      contactPhone = passenger.slice(comma + 1).replace(/\D/g, '').slice(-10)
    }

    const scheduledArrival = this.parseArrival(field('Expected\\s+arrival'), receivedAt)

    // "Collect ₹651 in cash at the seat". Keyed on an amount to collect
    // rather than the word, which a prepaid "nothing to collect" also has.
    const pay = field('Payment') ?? ''
    const collect = /collect\s*₹\s*([\d,]+(?:\.\d+)?)/i.exec(pay)
    const collectPaise = collect ? rupeeStringToPaise(collect[1]) : null
    const paymentMode =
      (collectPaise !== null && collectPaise > 0) || /\b(cash|cod)\b/i.test(pay)
        ? ('COD' as const)
        : collectPaise === 0 || /\b(paid|prepaid|online)\b|nothing to collect/i.test(pay)
          ? ('PREPAID' as const)
          : null

    return {
      ok: true,
      order: {
        source: 'FOODONTRAINS',
        externalOrderId: orderId,
        outletName: 'FoodOnTrains',
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

  /** "25 Oct, 11:50 pm" → "25 Oct 23:50", then the shared year inference. */
  private parseArrival(raw: string | null, receivedAt: Date): Date | null {
    if (!raw) return null
    const m = /(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{1,2}):(\d{2})\s*([ap])\.?m\.?/i.exec(raw)
    if (!m) return parseAggregatorDate(raw.replace(',', ''), receivedAt)
    let hour = Number(m[3])
    if (hour < 1 || hour > 12) return null
    const pm = m[5].toLowerCase() === 'p'
    if (hour === 12) hour = pm ? 12 : 0
    else if (pm) hour += 12
    return parseAggregatorDate(`${m[1]} ${m[2]} ${hour}:${m[4]}`, receivedAt)
  }

  /**
   * "2 × veg pizza 1 ₹420", read from the "Items" label up to the next label.
   * Matched across the whole block rather than per line, so it does not care
   * whether the flattened HTML put each row on its own line or in cells.
   */
  private parseItems(text: string): Item[] {
    const start = /^[ \t]*Items\b/im.exec(text)
    if (!start) return []
    const rest = text.slice(start.index + start[0].length)
    const others = LABELS.filter((l) => l !== 'Items').map((l) => l.replace(/ /g, '\\s+')).join('|')
    const end = new RegExp(`^[ \\t]*(?:${others})\\b`, 'im').exec(rest)
    const block = end ? rest.slice(0, end.index) : rest

    const items: Item[] = []
    const row = /(\d+)\s*[×xX]\s+(.+?)\s*₹\s*[\d,]+(?:\.\d+)?/g
    for (const m of block.matchAll(row)) {
      const qty = Number(m[1])
      const name = m[2].replace(/\s+/g, ' ').trim()
      if (qty > 0 && name) items.push({ name, qty, notes: null })
    }
    return items
  }
}
