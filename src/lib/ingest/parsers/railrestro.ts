import type { OrderParser, ParseResult, ParsedOrder } from '../types'
import { MONTHS, looksLikePhone, rupeeStringToPaise } from './shared'

/**
 * RailRestro parser.
 *
 * An HTML mail with no text/plain part, so what arrives here is whatever
 * gmail/client.ts makes of the markup — including the <style> block, which
 * survives tag-stripping and lands as ~2KB of CSS ahead of the order itself.
 * Every field below is therefore matched by its own label rather than by
 * position, and `matches()` demands the order header as well as the vendor
 * name so a stylesheet mentioning the brand can never be mistaken for an order.
 *
 * Real sample (after the CSS blob):
 *         Dear KHANA KHAZANA,
 *         You have just received a new order, Please ensure delivery on the journey date:
 *  ORDER #: 5920534  Customer: Abhinav Anand  M. 9351274432
 *  TRAIN: 12817 / SWARNJAYANTI EX
 *  Delivery Time: 2026-09-25 21:16:00
 *  PNR No.: 6109438930  Coact/Seat: B4-46
 *
 *             Item Name     Price     Quantity     Total
 *      Veg Mini Thali     Rs. 164       2
 *       Rs. 328
 *             Total:     Rs. 328
 *             GST:     Rs. 16.4
 *             Subtotal:     Rs. 344.4
 *             Extra Charges:     Rs. 0
 *        Cashback:       Rs. 0.00
 *        Paid Total:      Rs. 344.4
 *        (Amount to collect)     Rs. 0/-
 *
 * Three things are unlike every other aggregator here.
 *
 * First: no delivery station, in code or in words. `stationCode` is returned
 * null and the station comes from the outlet the mail names in its greeting —
 * see the note on ParsedOrder.stationCode. RailRestro is the reason that
 * field is nullable.
 *
 * Second: the item table wraps. Each row's name/price/quantity sit on one
 * line and its line total on the next, so a row is matched by its shape
 * (name, "Rs. <price>", integer quantity) and the orphaned "Rs. <total>"
 * continuation is skipped rather than counted as a second item.
 *
 * Third: the money block is not fixed. SAMPLE_2 carries "Discount" and
 * "Final Total" rows that SAMPLE_1 has no equivalent for, so the amount is
 * taken from the last word on the subject — "Paid Total", what the customer
 * actually paid — and only falls back when that label is absent.
 *
 * The vendor's own field name is "Coact/Seat", a typo for "Coach"; it is
 * matched as it actually arrives, with the correct spelling also accepted in
 * case they ever fix it.
 */
export class RailRestroParser implements OrderParser {
  readonly source = 'RAILRESTRO' as const

  matches(body: string): boolean {
    return /\brail\s*restro\b/i.test(body) && /\bORDER\s*#\s*:/i.test(body)
  }

  parse(body: string, _receivedAt: Date): ParseResult {
    const text = body.replace(/\r\n/g, '\n').replace(/\*/g, '')
    const partial: Partial<ParsedOrder> = { source: 'RAILRESTRO' }

    // "Dear KHANA KHAZANA," — the only thing naming the kitchen, and with no
    // station in the mail it is also what the station is resolved through.
    const outletMatch = /^\s*Dear\s+(.+?)\s*,\s*$/im.exec(text)
    if (!outletMatch) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'no outlet name in the greeting', partial }
    }
    const outletName = outletMatch[1].trim()
    partial.outletName = outletName

    const idMatch = /\bORDER\s*#\s*:\s*(\d+)/i.exec(text)
    if (!idMatch) {
      return { ok: false, reason: 'PARSE_FAILED', detail: 'no order id found', partial }
    }
    const externalOrderId = idMatch[1]
    partial.externalOrderId = externalOrderId

    // Order id, customer and phone share one line: "ORDER #: 5920534
    // Customer: Abhinav Anand  M. 9351274432". The name is lazy up to the
    // "M." that introduces the number, so a two-word name stays whole.
    const customerMatch = /Customer\s*:\s*(.+?)(?:\s{2,}|\t+)M\.\s*([\d\s/+-]+)/i.exec(text)
    const contactName = customerMatch?.[1]?.trim() || null
    // Some orders carry two numbers separated by a slash; the first is the
    // one RailRestro's own dashboard treats as the customer's.
    const phoneRaw = customerMatch?.[2]?.split('/')[0] ?? null
    const contactPhone =
      phoneRaw && looksLikePhone(phoneRaw) ? phoneRaw.replace(/\D/g, '').slice(-10) : null

    const trainMatch = /\bTRAIN\s*:\s*(\d{3,5})\s*\/\s*(.+)/i.exec(text)
    const trainNo = trainMatch?.[1] ?? null
    const trainName = trainMatch?.[2]?.trim() || null

    // "Coact/Seat: B4-46" — one field holding both coach and berth.
    const seatMatch = /Coac[ht]\s*\/\s*Seat\s*:\s*(\S+)/i.exec(text)
    const rawSeat = seatMatch?.[1] ?? null
    const seatParts = rawSeat ? /^(.+)-([^-]+)$/.exec(rawSeat) : null
    const coach = seatParts?.[1]?.toUpperCase() ?? null
    const berth = seatParts?.[2] ?? null

    const scheduledArrival = this.parseDeliveryTime(text)

    const items = this.parseItems(text)
    if (items.length === 0) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'no order items found', partial }
    }

    const amountPaise = this.parseAmount(text)
    if (amountPaise === null) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'paid total missing or unparseable', partial }
    }

    // "(Amount to collect)  Rs. 0/-". Zero means the customer has already
    // paid; anything else is cash the rider has to come back with, so this
    // single field is the whole of RailRestro's payment mode.
    const dueMatch = /\(\s*Amount\s*to\s*collect\s*\)\s*(?:-\s*)?Rs\.?\s*([\d,]+(?:\.\d+)?)/i.exec(text)
    const duePaise = dueMatch ? rupeeStringToPaise(dueMatch[1]) : null
    if (duePaise === null) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'amount to collect missing', partial }
    }
    const paymentMode = duePaise > 0 ? ('COD' as const) : ('PREPAID' as const)

    return {
      ok: true,
      order: {
        source: 'RAILRESTRO',
        externalOrderId,
        outletName,
        // The mail names no station at all — not even in words.
        stationName: null,
        stationCode: null,
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
   * "Delivery Time: 2026-09-25 21:16:00" in IST. Carries its own year, so
   * unlike the aggregators shared.ts was written for there is nothing to
   * infer from the email timestamp. A written-out month is accepted too,
   * since the surrounding template is clearly generated from a date helper
   * that could be reconfigured without warning.
   */
  private parseDeliveryTime(text: string): Date | null {
    const raw = /Delivery\s*Time\s*:\s*(.+)/i.exec(text)?.[1]?.trim()
    if (!raw) return null

    const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})[\sT]+(\d{1,2}):(\d{2})/.exec(raw)
    if (iso) {
      return this.buildIst(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), Number(iso[4]), Number(iso[5]))
    }

    const named = /^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s](\d{4}),?\s+(\d{1,2}):(\d{2})/.exec(raw)
    if (named) {
      const month = MONTHS[named[2].toLowerCase()]
      if (month === undefined) return null
      return this.buildIst(Number(named[3]), month, Number(named[1]), Number(named[4]), Number(named[5]))
    }

    return null
  }

  private buildIst(year: number, month: number, day: number, hour: number, minute: number): Date | null {
    if (month < 0 || month > 11 || day < 1 || day > 31 || hour > 23 || minute > 59) return null
    const d = new Date(
      `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` +
        `T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+05:30`,
    )
    return Number.isNaN(d.getTime()) ? null : d
  }

  /**
   * Rows between the "Item Name / Price / Quantity / Total" header and the
   * "Total:" summary line.
   *
   * A row is recognised by its shape rather than by its column count: the
   * name, then "Rs. <price>", then an integer quantity. The line total wraps
   * onto a line of its own, which fails that shape and is skipped — counting
   * columns instead would read every item twice.
   */
  private parseItems(text: string): { name: string; qty: number; notes: string | null }[] {
    const lines = text.split('\n')
    const headerIdx = lines.findIndex((l) => /Item\s*Name/i.test(l) && /Quantity/i.test(l))
    if (headerIdx < 0) return []

    const items: { name: string; qty: number; notes: string | null }[] = []
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue
      // The summary block starts here. "Total:" with its colon, so an item
      // that happens to be named "... Total" cannot end the table early.
      if (/^Total\s*:/i.test(line)) break

      const row = /^(.+?)(?:\s{2,}|\t+)Rs\.?\s*[\d,]+(?:\.\d+)?(?:\s{2,}|\t+)(\d+)\s*$/i.exec(line)
      if (!row) continue

      const name = row[1].trim()
      const qty = Number(row[2])
      if (!name || !Number.isFinite(qty) || qty <= 0) continue
      // RailRestro sends no per-item description; the name is the whole of it.
      items.push({ name, qty, notes: null })
    }
    return items
  }

  /**
   * What the customer paid. "Paid Total" is the figure at the bottom of the
   * summary, after GST, discount and cashback have all been applied — the
   * only one of the eight money rows that means that. The fallbacks exist
   * because the rows above it come and go between orders: SAMPLE_2 has a
   * Discount and a Final Total, SAMPLE_1 has neither.
   */
  private parseAmount(text: string): number | null {
    const labels = [/Paid\s*Total/i, /Final\s*Total/i, /Subtotal/i]
    for (const label of labels) {
      const re = new RegExp(`${label.source}\\s*:?\\s*(?:-\\s*)?Rs\\.?\\s*([\\d,]+(?:\\.\\d+)?)`, 'i')
      const m = re.exec(text)
      if (m) {
        const paise = rupeeStringToPaise(m[1])
        if (paise !== null) return paise
      }
    }
    return null
  }
}
