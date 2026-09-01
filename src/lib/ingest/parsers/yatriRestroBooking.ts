import type { OrderParser, ParseResult, ParsedOrder } from '../types'
import { normalisePaymentMode, rupeeStringToPaise } from './shared'

/**
 * YatriRestro's HTML "Order Booking Confirmation" template — a second format
 * from the same vendor as YatriRestroParser's pipe-delimited one, laid out as
 * a label/value table instead. Kept as its own class rather than folded into
 * YatriRestroParser: the two share nothing but a source and a signature, and
 * a single parser branching on shape would be harder to read than two small
 * ones (the same reasoning plan §6 gives for DailyYatri getting its own
 * module).
 *
 * Real sample, after HTML-table extraction (label/value cells, tab- or
 * multi-space-separated — see extractBody's table handling in gmail/client.ts):
 *
 *   Order Booking Confirmation
 *   ...
 *   ORDER No    1000085034    MOBILE NO    8789151114
 *   CUSTOMER NAME    aman    TRAIN No /NAME    22465 / BABA B DHAM EXP
 *   DELIVERY DATE        COACH/BERTH    A1 / 21
 *   PAYMENT STATUS    CASH_ON_DELIVERY    Station Code/Name    DDU / PT.DEEN DAYAL UPADHYAYA JN.
 *   Outlet Name    THE CHINESE HUB    Outlet Contact    9264296066
 *   Order Item Details:
 *   Item    Description    Price    Quantity    Amount
 *   Chicken lollipop Fry 4pc    4pc    ₹ 216    1    ₹ 216
 *   Sub Total    ₹ 216
 *   GST    ₹ 10.8
 *   Discount    ₹ 0
 *   Grand Total (Inclusive of all taxes)    ₹ 227
 *   Warm Regards,
 *   YATRI RESTRO
 *
 * The vendor also sends a "Dear Partner, please prepare order and deliver on
 * time" copy of the same table addressed to the outlet itself — header just
 * "Order Confirmation" (no "Booking"), same field layout, but with no Outlet
 * Name/Outlet Contact row at all. Both headers are accepted here since the
 * rest of the template is identical; the missing outlet name still fails
 * closed below rather than guessing which restaurant it belongs to.
 *
 * DELIVERY DATE, when present, is "DD-MM-YYYY, HH:mm" in IST — e.g.
 * "01-09-2026, 11:19".
 */
export class YatriRestroBookingParser implements OrderParser {
  readonly source = 'YATRIRESTRO' as const

  private static readonly LABELS = new Set([
    'ORDERNO', 'MOBILENO', 'CUSTOMERNAME', 'TRAINNO/NAME', 'DELIVERYDATE',
    'COACH/BERTH', 'PAYMENTSTATUS', 'STATIONCODE/NAME', 'OUTLETNAME', 'OUTLETCONTACT',
  ])

  /** See the outlet-resolution comment in parse() below. */
  private static readonly DEFAULT_OUTLET_NAME = 'YATRI RESTRO'

  matches(body: string): boolean {
    return /Order\s*(?:Booking\s*)?Confirmation/i.test(body) && /YATRI\s*RESTRO/i.test(body)
  }

  parse(body: string, _receivedAt: Date): ParseResult {
    const text = body.replace(/\r\n/g, '\n')
    const partial: Partial<ParsedOrder> = { source: 'YATRIRESTRO' }
    const fields = this.readFields(text)

    const orderId = fields.get('ORDERNO') ?? null
    if (!orderId) {
      return { ok: false, reason: 'PARSE_FAILED', detail: 'no order id found', partial }
    }
    partial.externalOrderId = orderId

    // "DDU / PT.DEEN DAYAL UPADHYAYA JN." — code first, name second, the
    // opposite order from the pipe-delimited template's "NAME-CODE".
    const stationRaw = fields.get('STATIONCODE/NAME') ?? null
    const stationMatch = stationRaw ? /^([A-Z]{2,5})\s*\/\s*(.+)$/i.exec(stationRaw) : null
    if (!stationMatch) {
      return {
        ok: false, reason: 'MISSING_FIELD',
        detail: `station code not parseable from ${JSON.stringify(stationRaw)}`, partial,
      }
    }
    partial.stationCode = stationMatch[1].trim().toUpperCase()
    partial.stationName = stationMatch[2].trim() || null

    partial.contactName = fields.get('CUSTOMERNAME') ?? null
    partial.contactPhone = fields.get('MOBILENO')?.replace(/\D/g, '').slice(-10) || null

    const trainRaw = fields.get('TRAINNO/NAME') ?? null
    const trainMatch = trainRaw ? /^(\d{3,5})\s*\/\s*(.+)$/.exec(trainRaw) : null
    partial.trainNo = trainMatch ? trainMatch[1] : null
    partial.trainName = trainMatch ? trainMatch[2].trim() : null

    // "RAC/A2 / 17" — a waitlist-status prefix (RAC, WL, ...) ahead of the
    // usual "coach / berth", seen on an unconfirmed-seat order. The prefix is
    // kept as part of coach rather than dropped, since it's real seat status.
    const seatRaw = fields.get('COACH/BERTH') ?? null
    const seatMatch = seatRaw
      ? /^(?:([A-Za-z]+)\/)?([A-Za-z]+\d*)\s*\/\s*(\d+)$/.exec(seatRaw)
      : null
    partial.coach = seatMatch
      ? (seatMatch[1] ? `${seatMatch[1]}/${seatMatch[2]}` : seatMatch[2]).toUpperCase()
      : (seatRaw?.trim() || null)
    partial.berth = seatMatch ? seatMatch[3] : null
    partial.rawSeat = seatMatch ? `${partial.coach}-${partial.berth}` : partial.coach

    const deliveryRaw = fields.get('DELIVERYDATE') ?? null
    partial.scheduledArrival = deliveryRaw ? YatriRestroBookingParser.parseDeliveryDate(deliveryRaw) : null

    const items = this.parseItems(text)
    if (items.length === 0) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'no order items found', partial }
    }
    partial.items = items

    // The vendor sometimes puts the label and its ₹ amount on the same line
    // ("Grand Total (Inclusive of all taxes)    ₹ 709"), and sometimes on two
    // consecutive lines with nothing else between them (one cell per line, no
    // delimiter at all — see the flattening comment on parseItems). Reading
    // "whatever token comes right after the Grand Total label" survives both.
    const allTokens = YatriRestroBookingParser.flattenTokens(text.split('\n'))
    const gtIdx = allTokens.findIndex((t) => /^Grand\s*Total/i.test(t))
    const amountToken = gtIdx >= 0 ? allTokens[gtIdx + 1] ?? null : null
    const amountMatch = amountToken ? /₹\s*([\d,]+(?:\.\d+)?)/.exec(amountToken) : null
    const amountPaise = amountMatch ? rupeeStringToPaise(amountMatch[1]) : null
    if (amountPaise === null) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'grand total missing or unparseable', partial }
    }
    partial.amountPaise = amountPaise

    const paymentStatus = fields.get('PAYMENTSTATUS') ?? null
    partial.paymentMode = paymentStatus ? normalisePaymentMode(paymentStatus) : null

    // Checked last so a "Dear Partner" email — which never states the outlet —
    // still leaves every other field filled in on `partial` before this runs.
    //
    // Interim call, made explicitly by the business (not a guess this code is
    // making on its own): the "Dear Partner" template never names an outlet,
    // so every order from it is routed to the "YATRI RESTRO" restaurant — a
    // real registered outlet at CNB/Kanpur Central — until there's a real way
    // to tell which physical kitchen prepared it. matchOutlet's own
    // station-code check still applies afterwards, so an order from a
    // different station just fails to UNKNOWN_OUTLET instead of being routed
    // to the wrong city's kitchen.
    const outletName = fields.get('OUTLETNAME') ?? YatriRestroBookingParser.DEFAULT_OUTLET_NAME
    partial.outletName = outletName

    const order: ParsedOrder = {
      source: 'YATRIRESTRO',
      externalOrderId: orderId,
      outletName,
      stationName: partial.stationName ?? null,
      stationCode: partial.stationCode!,
      contactName: partial.contactName ?? null,
      contactPhone: partial.contactPhone ?? null,
      trainNo: partial.trainNo ?? null,
      trainName: partial.trainName ?? null,
      coach: partial.coach ?? null,
      berth: partial.berth ?? null,
      rawSeat: partial.rawSeat ?? null,
      scheduledArrival: partial.scheduledArrival ?? null,
      items: partial.items!,
      amountPaise: partial.amountPaise!,
      paymentMode: partial.paymentMode ?? null,
    }

    return { ok: true, order }
  }

  /** "01-09-2026, 11:19" (IST, DD-MM-YYYY) — the only format seen from this vendor so far. */
  private static parseDeliveryDate(raw: string): Date | null {
    const m = /^(\d{1,2})-(\d{1,2})-(\d{4}),?\s*(\d{1,2}):(\d{2})$/.exec(raw.trim())
    if (!m) return null
    const [, dd, mm, yyyy, hh, min] = m
    const iso =
      `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}` +
      `T${hh.padStart(2, '0')}:${min}:00+05:30`
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? null : d
  }

  private static norm(s: string): string {
    return s.replace(/\s+/g, '').toUpperCase()
  }

  private static splitCells(line: string): string[] {
    return line.split(/\t+|[ ]{2,}/).map((c) => c.trim()).filter((c) => c.length > 0)
  }

  /**
   * Like splitCells, but keeps empty cells when the line is tab-delimited —
   * an item row is a fixed 5-column schema (name/description/price/qty/amount)
   * and a blank description must not shift quantity and amount left by one.
   * Collapsing is only safe for the free-text label rows, where an empty cell
   * is disambiguated by matching known labels instead of column position.
   */
  private static splitRow(line: string): string[] {
    if (line.includes('\t')) return line.split('\t').map((c) => c.trim())
    return YatriRestroBookingParser.splitCells(line)
  }

  /**
   * Concatenates every line's cells into one token stream. The vendor's HTML
   * isn't always a real <table> — as observed straight from /admin/inbox, it
   * is sometimes one <div> per cell with no delimiter between them at all, so
   * a label and its value can each end up alone on their own line rather than
   * sharing one tab/space-delimited row. Flattening first means later code
   * can work purely in terms of "the next token", whichever line it actually
   * came from.
   */
  private static flattenTokens(lines: string[]): string[] {
    const tokens: string[] = []
    for (const line of lines) tokens.push(...YatriRestroBookingParser.splitRow(line))
    return tokens
  }

  /**
   * Each row is a 4-column table: one or two label/value pairs. A label with
   * an empty value — "DELIVERY DATE" next to a blank cell — leaves no token
   * behind once split, so pairing cells by position misfires (the next row's
   * label would be read as this row's value). Matching every cell against the
   * known label set and treating whatever follows as its value survives that.
   */
  private readFields(text: string): Map<string, string> {
    const map = new Map<string, string>()
    const lines = text.split('\n')
    const start = lines.findIndex((l) => /Order\s*details\s*:/i.test(l))
    const end = lines.findIndex((l) => /Order\s*Item\s*Details\s*:/i.test(l))
    const section = lines.slice(start >= 0 ? start + 1 : 0, end >= 0 ? end : lines.length)

    let currentLabel: string | null = null
    for (const line of section) {
      for (const cell of YatriRestroBookingParser.splitCells(line)) {
        const key = YatriRestroBookingParser.norm(cell)
        if (YatriRestroBookingParser.LABELS.has(key)) {
          currentLabel = key
        } else if (currentLabel) {
          map.set(currentLabel, cell)
          currentLabel = null
        }
      }
    }
    return map
  }

  /**
   * Rows between the "Item/Description/Price/Quantity/Amount" header and the
   * Sub Total/GST/Discount/Grand Total summary — a fixed 5-column schema.
   * Flattening the whole section into one token stream first (see
   * flattenTokens) and chunking it in fives handles a row packed onto one
   * tab/space-delimited line and a row spread one value per line identically,
   * since chunking only cares about token position, not which line it came
   * from.
   */
  private parseItems(text: string): { name: string; qty: number; notes: string | null }[] {
    const lines = text.split('\n')
    const detailsIdx = lines.findIndex((l) => /Order\s*Item\s*Details\s*:/i.test(l))
    if (detailsIdx < 0) return []

    const tokens = YatriRestroBookingParser.flattenTokens(lines.slice(detailsIdx + 1))

    const norm = YatriRestroBookingParser.norm
    const headerIdx = tokens.findIndex((_, i) =>
      norm(tokens[i]) === 'ITEM' &&
      norm(tokens[i + 1] ?? '') === 'DESCRIPTION' &&
      norm(tokens[i + 2] ?? '') === 'PRICE' &&
      norm(tokens[i + 3] ?? '') === 'QUANTITY' &&
      norm(tokens[i + 4] ?? '') === 'AMOUNT',
    )
    if (headerIdx < 0) return []

    const bodyTokens = tokens.slice(headerIdx + 5)
    const summaryIdx = bodyTokens.findIndex((t) => /^(Sub\s*Total|GST|Discount|Grand\s*Total)/i.test(t))
    const itemTokens = summaryIdx >= 0 ? bodyTokens.slice(0, summaryIdx) : bodyTokens

    const items: { name: string; qty: number; notes: string | null }[] = []
    for (let i = 0; i + 4 < itemTokens.length; i += 5) {
      const [name, description, , quantity] = itemTokens.slice(i, i + 5)
      const qty = Number(quantity)
      if (!Number.isFinite(qty)) continue
      items.push({ name: name.trim(), qty, notes: description?.trim() || null })
    }
    return items
  }
}
