import type { OrderParser, ParseResult, ParsedOrder } from '../types'
import { looksLikePhone, normalisePaymentMode, rupeeStringToPaise } from './shared'

/**
 * RelFood parsers. Two of them, because the same order reaches the kitchen in
 * two unrelated shapes: an order-summary mail, and a WhatsApp message that
 * somebody pastes in.
 *
 * The mail — HTML tables and no text/plain part, so the label/value gaps
 * below are tabs by the time gmail/client.ts has flattened it, or runs of
 * spaces when it is pasted:
 *
 *   Samim Abedin
 *   IRCTC Order No. 2493864512
 *   Booking Date : 09-10-2026
 *   Customer Name    Samim Abedin
 *   Contact Number    9563871687
 *   Train No./Name    15483 / SIKKIMMAHANANDA
 *   Coach/Seat    A1/26
 *   Payment Mode    PAID
 *   Payment to collect    0
 *   REL FOOD Ref.No : 1192186
 *   OUTLET NAME : THE COSMOZIN LOUNGE
 *   Station Name & Code : KANPUR CENTRAL (CNB)
 *   Delivery Date & Time : 10/9/2026 & 12:50
 *   Item    Price    Quantity    Total
 *   Special Egg Thali
 *   Egg Curry (2pcs), Daal Fry, Jeera Rice, ..., Paper Napkin    239    1    239
 *   Sub Total    239
 *   Delivery Fee    0.00
 *   GST    12
 *   Total    251
 *   RELFOOD - A Unit of Durga Enterprises
 *
 * The WhatsApp message, for the same order:
 *
 *   Order Information:
 *   Order ID: 1192186
 *   Station: KANPUR CENTRAL (CNB)
 *   Outlet: THE COSMOZIN LOUNGE
 *   Train: 15483 (SIKKIMMAHANANDA)
 *   Compartment: A1/26
 *   Customer Details:
 *   Name: Samim Abedin
 *   Phone: 9563871687
 *   Order Summary:
 *   Items Ordered: 1 x Special Egg Thali..
 *   Delivery Date Time: 09-10-2026 12:50
 *   Payment Information:
 *   Amount: ₹ 251
 *   Order Type: PRE_PAID
 *   Additional Remarks: NA
 *
 * Three things are unlike every other aggregator here.
 *
 * First: externalOrderId is RelFood's own reference, not the IRCTC order
 * number the mail also carries. The WhatsApp message has only the reference,
 * and the unique index on externalOrderId is the one thing stopping an order
 * that arrives by mail and is then pasted from WhatsApp from being cooked
 * twice. Both layouts therefore have to agree on the id, and the reference is
 * the only id both of them have.
 *
 * Second: the two layouts write the same delivery time differently, and the
 * mail's is month-first. This order was booked and delivered on 9 Oct 2026:
 * the mail says "10/9/2026 & 12:50" (M/D/YYYY, unpadded) beside a booking
 * date of "09-10-2026", and the WhatsApp message says "09-10-2026 12:50"
 * (DD-MM-YYYY). A delivery cannot precede its own booking, which is what
 * rules out reading the mail's date as 10 Sep. A second mail, sent on 8 Oct at
 * 07:29 for a "10/8/2026 & 07:55" delivery, reads the same way.
 *
 * Third: the WhatsApp message never names RelFood. It is recognised by its
 * section headings and labels alone, so its parser sits last in PARSERS,
 * where it cannot take a message that names its own vendor.
 *
 * Multi-vendor aggregator — both layouts name the outlet, which still resolves
 * through matchOutlet() like every other outlet name.
 */
type Item = ParsedOrder['items'][number]

/** "KANPUR CENTRAL (CNB)" — written the same way in both layouts. */
function parseStation(raw: string | null): { name: string | null; code: string } | null {
  const m = raw ? /^(.+?)\s*\(\s*([A-Za-z]{2,5})\s*\)/.exec(raw) : null
  return m ? { name: m[1].trim() || null, code: m[2].toUpperCase() } : null
}

/**
 * "A1/26" — coach and berth in one field. Split on the last slash, so a coach
 * that carries a slash of its own ("RAC/S2/23") keeps it.
 */
function parseSeat(raw: string | null): Pick<ParsedOrder, 'coach' | 'berth' | 'rawSeat'> {
  const m = raw ? /^(.+)\/\s*([^/\s]+)$/.exec(raw) : null
  const coach = m?.[1]?.trim().toUpperCase() || null
  const berth = m?.[2] ?? null
  return { coach, berth, rawSeat: coach && berth ? `${coach}-${berth}` : null }
}

function parsePhone(raw: string | null): string | null {
  return raw && looksLikePhone(raw) ? raw.replace(/\D/g, '').slice(-10) : null
}

function parseRupees(raw: string | null): number | null {
  const m = raw ? /[\d,]+(?:\.\d+)?/.exec(raw) : null
  return m ? rupeeStringToPaise(m[0]) : null
}

/** An IST wall-clock time as an instant. `month` is 1-12. */
function istDate(year: number, month: number, day: number, hour: number, minute: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  const d = new Date(`${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00+05:30`)
  return Number.isNaN(d.getTime()) ? null : d
}

export class RelFoodParser implements OrderParser {
  readonly source = 'RELFOOD' as const

  matches(body: string): boolean {
    return /\bREL\s*FOOD\b/i.test(body) && /\bRef\.?\s*No\b/i.test(body)
  }

  parse(body: string, _receivedAt: Date): ParseResult {
    const text = body.replace(/\r\n/g, '\n')
    const partial: Partial<ParsedOrder> = { source: 'RELFOOD' }

    // Matched by label wherever it falls, not at the start of a line:
    // gmail/client.ts only breaks a line at </p>, </div>, </tr> and </li>, so
    // the "ORDER SUMMERY" <h4> lands on the same line as the "Customer Name"
    // row beneath it. Half the labels are followed by a colon and half by a
    // bare table gap; either is accepted after any of them, and no label here
    // is the start of another, so a single space is separator enough. A value
    // ends at the next tab, which is where its cell did.
    const field = (label: string): string | null => {
      const re = new RegExp(`${label}(?:[ \\t]*:[ \\t]*|[ \\t]+)([^\\t\\n]+)`, 'i')
      const v = re.exec(text)?.[1]?.trim()
      return v || null
    }

    const idMatch = /REL\s*FOOD\s*Ref\.?\s*No\.?\s*:?\s*(\d+)/i.exec(text)
    if (!idMatch) {
      return { ok: false, reason: 'PARSE_FAILED', detail: 'no RelFood reference number found', partial }
    }
    const externalOrderId = idMatch[1]
    partial.externalOrderId = externalOrderId

    const outletName = field('OUTLET\\s*NAME')
    if (!outletName) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'outlet name missing', partial }
    }
    partial.outletName = outletName

    const stationRaw = field('Station\\s*Name\\s*&\\s*Code')
    const station = parseStation(stationRaw)
    if (!station) {
      return {
        ok: false, reason: 'MISSING_FIELD',
        detail: `station code not parseable from ${JSON.stringify(stationRaw)}`, partial,
      }
    }
    partial.stationName = station.name
    partial.stationCode = station.code

    const trainRaw = field('Train\\s*No\\.?\\s*\\/\\s*Name')
    const trainMatch = trainRaw ? /^(\d{3,5})\s*\/\s*(.+)$/.exec(trainRaw) : null
    const trainNo = trainMatch?.[1] ?? null
    const trainName = trainMatch?.[2]?.trim() || null

    const seat = parseSeat(field('Coach\\s*\\/\\s*Seat'))

    const contactName = field('Customer\\s*Name')
    const contactPhone = parsePhone(field('Contact\\s*Number'))

    const scheduledArrival = this.parseDeliveryDate(field('Delivery\\s*Date\\s*&\\s*Time'))

    const items = this.parseItems(text)
    if (items.length === 0) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'no order items found', partial }
    }

    // "Total  251", and not the "Sub Total  239" two rows above it. A figure
    // has to follow, which is what skips the item table's "Total" column.
    const totalMatch =
      /(?<!Sub[ \t]*)\bTotal\b[ \t]*:?[ \t]*(?:₹|Rs\.?)?[ \t]*([\d,]+(?:\.\d+)?)/i.exec(text)
    const amountPaise = totalMatch ? rupeeStringToPaise(totalMatch[1]) : null
    if (amountPaise === null) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'total missing or unparseable', partial }
    }

    // "Payment to collect" is read the way RailRestro's "(Amount to collect)"
    // is: anything above zero is cash the rider has to come back with. The
    // "Payment Mode" label beside it ("PAID", "COD") says the same thing in
    // both samples and is only the fallback.
    const duePaise = parseRupees(field('Payment\\s*to\\s*collect'))
    const modeRaw = field('Payment\\s*Mode')
    const paymentMode: ParsedOrder['paymentMode'] =
      duePaise !== null
        ? duePaise > 0 ? 'COD' : 'PREPAID'
        : modeRaw ? normalisePaymentMode(modeRaw.replace(/\s+/g, '_')) : null

    return {
      ok: true,
      order: {
        source: 'RELFOOD',
        externalOrderId,
        outletName,
        stationName: station.name,
        stationCode: station.code,
        contactName,
        contactPhone,
        trainNo,
        trainName,
        ...seat,
        scheduledArrival,
        items,
        amountPaise,
        paymentMode,
      },
    }
  }

  /** "10/9/2026 & 12:50" — month first, unpadded. See the note at the top. */
  private parseDeliveryDate(raw: string | null): Date | null {
    const m = raw ? /(\d{1,2})\/(\d{1,2})\/(\d{4})\s*&?\s*(\d{1,2}):(\d{2})/.exec(raw) : null
    if (!m) return null
    return istDate(Number(m[3]), Number(m[1]), Number(m[2]), Number(m[4]), Number(m[5]))
  }

  /**
   * Rows between the "Item / Price / Quantity / Total" header and "Sub Total".
   *
   * The first cell holds the dish and, on a line of its own beneath it, what
   * the dish comes with — so one item spans two lines of text, and the three
   * figures trail whichever line came last. A row is therefore closed by a
   * line ending in price, quantity and total; the lines gathered before it
   * are the name, then the description, which is kept as the item's notes.
   */
  private parseItems(text: string): Item[] {
    const lines = text.split('\n').map((l) => l.trim())
    const headerIdx = lines.findIndex((l) => /\bItem\b.*\bPrice\b.*\bQuantity\b/i.test(l))
    if (headerIdx < 0) return []

    // The leading text is optional, and tried last: the figures can sit on a
    // line of their own, and a "₹" in front of the price belongs to the price.
    const money = '(?:₹|Rs\\.?)?[ \\t]*[\\d,]+(?:\\.\\d+)?'
    const rowRe = new RegExp(`^(?:(.*?)[ \\t]+)??${money}[ \\t]+(\\d+)[ \\t]+${money}$`, 'i')

    const items: Item[] = []
    let pending: string[] = []
    for (const line of lines.slice(headerIdx + 1)) {
      if (!line) continue
      if (/^(?:Sub\s*)?Total\b/i.test(line)) break

      const row = rowRe.exec(line)
      if (!row) {
        pending.push(line)
        continue
      }

      const cell = [...pending, row[1]?.trim() ?? ''].filter(Boolean)
      pending = []
      const qty = Number(row[2])
      if (cell.length === 0 || qty <= 0) continue
      items.push({ name: cell[0], qty, notes: cell.slice(1).join(' ') || null })
    }
    return items
  }
}

export class RelFoodWhatsAppParser implements OrderParser {
  readonly source = 'RELFOOD' as const

  // No vendor name to key off, so the shape has to carry it: the opening
  // section heading, plus the two labels nobody else uses for these fields.
  matches(body: string): boolean {
    const text = body.replace(/\*/g, '')
    return (
      /^\s*Order\s*Information\s*:/im.test(text) &&
      /^\s*Compartment\s*:/im.test(text) &&
      /^\s*Items\s*Ordered\s*:/im.test(text)
    )
  }

  parse(body: string, _receivedAt: Date): ParseResult {
    // WhatsApp's bold markers come along when a message is copied out of it.
    const text = body.replace(/\r\n/g, '\n').replace(/\*/g, '')
    const partial: Partial<ParsedOrder> = { source: 'RELFOOD' }

    const field = (label: string): string | null => {
      const re = new RegExp(`^[ \\t]*${label}[ \\t]*:[ \\t]*(.+)$`, 'im')
      const v = re.exec(text)?.[1]?.trim()
      return v || null
    }

    const externalOrderId = /\d+/.exec(field('Order\\s*ID') ?? '')?.[0]
    if (!externalOrderId) {
      return { ok: false, reason: 'PARSE_FAILED', detail: 'no order id found', partial }
    }
    partial.externalOrderId = externalOrderId

    const outletName = field('Outlet')
    if (!outletName) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'outlet name missing', partial }
    }
    partial.outletName = outletName

    const stationRaw = field('Station')
    const station = parseStation(stationRaw)
    if (!station) {
      return {
        ok: false, reason: 'MISSING_FIELD',
        detail: `station code not parseable from ${JSON.stringify(stationRaw)}`, partial,
      }
    }
    partial.stationName = station.name
    partial.stationCode = station.code

    // "15483 (SIKKIMMAHANANDA)" — the name in brackets, where the mail uses a slash.
    const trainMatch = /^(\d{3,5})\s*(?:\((.+)\))?/.exec(field('Train') ?? '')
    const trainNo = trainMatch?.[1] ?? null
    const trainName = trainMatch?.[2]?.trim() || null

    const seat = parseSeat(field('Compartment'))

    const contactName = field('Name')
    const contactPhone = parsePhone(field('Phone'))

    const scheduledArrival = this.parseDeliveryDate(field('Delivery\\s*Date\\s*Time'))

    const items = this.parseItems(field('Items\\s*Ordered'))
    if (items.length === 0) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'no order items found', partial }
    }
    // The message has one remarks line for the whole order and no per-item
    // description; the first item carries it, so it reaches the kitchen.
    const remarks = field('Additional\\s*Remarks')
    if (remarks && !/^N\/?A$/i.test(remarks)) items[0].notes = remarks

    const amountPaise = parseRupees(field('Amount'))
    if (amountPaise === null) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'amount missing or unparseable', partial }
    }

    const payRaw = field('Order\\s*Type')
    const paymentMode = payRaw ? normalisePaymentMode(payRaw.replace(/\s+/g, '_')) : null

    return {
      ok: true,
      order: {
        source: 'RELFOOD',
        externalOrderId,
        outletName,
        stationName: station.name,
        stationCode: station.code,
        contactName,
        contactPhone,
        trainNo,
        trainName,
        ...seat,
        scheduledArrival,
        items,
        amountPaise,
        paymentMode,
      },
    }
  }

  /** "09-10-2026 12:50" — day first, the reverse of the mail. */
  private parseDeliveryDate(raw: string | null): Date | null {
    const m = raw ? /(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})/.exec(raw) : null
    if (!m) return null
    return istDate(Number(m[3]), Number(m[2]), Number(m[1]), Number(m[4]), Number(m[5]))
  }

  /**
   * "1 x Special Egg Thali.." — quantity, name, and a trailing ".." that is
   * not part of the name. Only single-item messages have been seen; a second
   * item is assumed to follow on the same line after a comma or that "..",
   * since splitting on the next "<n> x" costs nothing if it never happens.
   */
  private parseItems(raw: string | null): Item[] {
    const items: Item[] = []
    for (const chunk of (raw ?? '').split(/[.,;]+\s*(?=\d+\s*x\s)/i)) {
      const m = /^(\d+)\s*x\s+(.+?)[\s.,;]*$/i.exec(chunk.trim())
      const qty = m ? Number(m[1]) : 0
      if (m && qty > 0) items.push({ name: m[2].trim(), qty, notes: null })
    }
    return items
  }
}
