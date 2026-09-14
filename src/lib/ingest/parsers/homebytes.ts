import type { OrderParser, ParseResult, ParsedOrder } from '../types'
import { MONTHS, looksLikePhone, normalisePaymentMode, rupeeStringToPaise } from './shared'

/**
 * HomeBytes parser. A generated "Order Invoice" mail, near-identical shape to
 * RajBhog's (same colon-delimited fields, same "Invoice <own-id> / <numeric>"
 * line, same FSSAI footer boilerplate down to the phone-label typo "Pnone
 * Np.") — evidently the same AdminLTE-based invoice template, just re-skinned
 * per aggregator. `matches()` keys off the vendor name rather than the
 * template shape, since the shape alone would collide with RajBhog.
 *
 * Real sample:
 *   Booking Date: 14 Sep 2026, 08:53
 *   Delivery Date: 14 Sep 2026, 13:30
 *   FSSAI NO.: 22725315001462	AdminLTE Logo
 *
 *   To
 *   Customer Name : Satvir
 *   Customer Contact : 9718488269
 *   Customer Email :
 *
 *   Invoice HB001273086 / 2486073972
 *   Payment: CASH_ON_DELIVERY
 *   Coach / Berth: H1/G / 19
 *   Train: 13051 / NETAJI EXPRESS
 *   Delivery Station: CNB / KANPUR CENTRAL
 *
 *   SL#	Item	Description	Qty	Price	GST	Amount
 *   1	Non Veg Mini Thali	Chicken curry  2pcs  +  Daal fry +  Jeera rice + ...	1	240.00	12.00	240.00
 *   Subtotal:	240.00
 *   GST (5%)	12.00
 *   Discount	0.00
 *   Delivery:	0
 *   Total:	252.00
 *   ...
 *   Warm Regards
 *   HomeBytes
 *   Phone Np. 91 9234282644
 *
 * Unlike RajBhog's item table — plain single-spaced description text, safe to
 * column-split on runs of 2+ spaces — HomeBytes' Description cell itself
 * contains irregular double-space runs (an artefact of "  +  " joins between
 * dish components), so a whitespace-run split would misread it as extra
 * columns. The table instead relies on the real tab characters an HTML table
 * leaves behind when flattened to text (same as BrotherByte's label/value
 * lines): rows are split on tabs only, indexed by the header's fixed 7
 * columns, and the Description cell is kept whole as the item's notes.
 *
 * Invoice line carries two ids — HomeBytes' own ("HB...") and, after the
 * slash, the IRCTC-style numeric order id every other parser treats as
 * externalOrderId. Single vendor, no outlet field in the body — same
 * fixed-name treatment as RajBhog, Yatribhojan, and OLF.
 */
export class HomeBytesParser implements OrderParser {
  readonly source = 'HOMEBYTES' as const

  matches(body: string): boolean {
    return /\bHomeBytes\b/i.test(body) && /FSSAI\s*NO/i.test(body)
  }

  parse(body: string, _receivedAt: Date): ParseResult {
    const text = body.replace(/\r\n/g, '\n')
    const partial: Partial<ParsedOrder> = { source: 'HOMEBYTES', outletName: 'HomeBytes' }

    const field = (label: string): string | null => {
      const re = new RegExp(`${label}\\s*:\\s*(.+)`, 'i')
      const m = re.exec(text)
      if (!m) return null
      const v = m[1].trim()
      return v || null
    }

    const invoiceMatch = /Invoice\s+\S+\s*\/\s*(\d+)/i.exec(text)
    if (!invoiceMatch) {
      return { ok: false, reason: 'PARSE_FAILED', detail: 'no invoice/order id found', partial }
    }
    const orderId = invoiceMatch[1]
    partial.externalOrderId = orderId

    const stationMatch = /Delivery\s*Station\s*:\s*([A-Za-z]{2,5})\s*\/\s*(.+)/i.exec(text)
    if (!stationMatch) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'delivery station missing', partial }
    }
    const stationCode = stationMatch[1].toUpperCase()
    const stationName = stationMatch[2].trim()
    partial.stationCode = stationCode
    partial.stationName = stationName

    const trainMatch = /Train\s*:\s*(\d{3,5})\s*\/\s*(.+)/i.exec(text)
    const trainNo = trainMatch?.[1] ?? null
    const trainName = trainMatch?.[2]?.trim() || null

    const seatMatch = /Coach\s*\/\s*Berth\s*:\s*(\S+)\s*\/\s*(\S+)/i.exec(text)
    const coach = seatMatch?.[1]?.toUpperCase() ?? null
    const berth = seatMatch?.[2] ?? null
    const rawSeat = coach && berth ? `${coach}-${berth}` : null

    const contactName = field('Customer\\s*Name')
    const phoneRaw = field('Customer\\s*Contact')
    const contactPhone =
      phoneRaw && looksLikePhone(phoneRaw) ? phoneRaw.replace(/\D/g, '').slice(-10) : null

    const scheduledArrival = this.parseDeliveryDate(field('Delivery\\s*Date'))

    const items = this.parseItems(text)
    if (items.length === 0) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'no order items found', partial }
    }

    const totalMatch = /\bTotal\s*:\s*([\d,]+(?:\.\d+)?)/i.exec(text)
    const amountPaise = totalMatch ? rupeeStringToPaise(totalMatch[1]) : null
    if (amountPaise === null) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'total amount missing or unparseable', partial }
    }

    const payRaw = field('Payment')
    const paymentMode = payRaw ? normalisePaymentMode(payRaw) : null

    return {
      ok: true,
      order: {
        source: 'HOMEBYTES',
        externalOrderId: orderId,
        outletName: 'HomeBytes',
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

  /** "14 Sep 2026, 13:30" — carries its own year, same shape as RajBhog's. */
  private parseDeliveryDate(raw: string | null): Date | null {
    if (!raw) return null
    const m = /(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{4}),?\s+(\d{1,2}):(\d{2})/.exec(raw)
    if (!m) return null

    const day = Number(m[1])
    const month = MONTHS[m[2].toLowerCase()]
    const year = Number(m[3])
    const hour = Number(m[4])
    const minute = Number(m[5])
    if (month === undefined || day < 1 || day > 31 || hour > 23 || minute > 59) return null

    const iso =
      `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` +
      `T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+05:30`
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? null : d
  }

  /**
   * Tab-separated rows between the "SL# Item Description Qty Price GST
   * Amount" header and "Subtotal:". Indexed by fixed position rather than
   * counted from the end (RajBhog's trick) because the columns here are
   * reliably tab-delimited, and counting from the end would misfire on a
   * Description cell whose own irregular double-space runs could otherwise
   * be mistaken for a column gutter.
   */
  private parseItems(text: string): { name: string; qty: number; notes: string | null }[] {
    const lines = text.split('\n')
    const headerIdx = lines.findIndex((l) => /SL#/i.test(l) && /Item/i.test(l))
    if (headerIdx < 0) return []

    const items: { name: string; qty: number; notes: string | null }[] = []
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue
      if (/^Subtotal\s*:/i.test(line)) break

      const cols = line.split(/\t+/)
      if (cols.length < 7) continue
      const qty = Number(cols[3].trim())
      if (!Number.isFinite(qty) || qty <= 0) continue
      const notes = cols[2].trim()
      items.push({ name: cols[1].trim(), qty, notes: notes || null })
    }
    return items
  }
}
