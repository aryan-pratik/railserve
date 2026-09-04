import type { OrderParser, ParseResult, ParsedOrder } from '../types'
import { MONTHS, looksLikePhone, normalisePaymentMode, rupeeStringToPaise } from './shared'

/**
 * RajBhog Khana parser. A generated "Order Invoice" mail, label-and-colon
 * fields up top and a whitespace-columned item table below.
 *
 * Real sample:
 *   Rajbhog Order Invoice        Booking Date: 04 Sep 2026, 21:49
 *    Delivery Date: 04 Sep 2026, 23:00
 *    FSSAI NO.: 22725315001462
 *
 *    To
 *    Customer Name : Shivam
 *    Customer Contact : 9931469044
 *    Customer Email :
 *         Invoice RBK001772779 / 2482879979
 *    Payment: PRE_PAID
 *    Coach / Berth: B7 / 10
 *    Train: 12590 / CHZ GKP SF EXP
 *    Delivery Station: CNB / KANPUR CENTRAL
 *
 *         SL#     Item     Description     Qty     Price     GST     Amount
 *       1     VEG MAHARAJA THALI     paneer veg dish, ...     1     255.00     12.11     255.00
 *     Subtotal:     255.00
 *     Total:     254.00
 *
 * The invoice line carries two ids — RajBhog's own ("RBK...") and, after the
 * slash, an IRCTC-style numeric order id matching the pattern every other
 * parser treats as externalOrderId. Single vendor, no outlet field in the
 * body — same fixed-name treatment as OLF and Yatribhojan.
 */
export class RajBhogParser implements OrderParser {
  readonly source = 'RAJBHOG' as const

  matches(body: string): boolean {
    return /Rajbhog\s+Order\s+Invoice/i.test(body) && /FSSAI\s*NO/i.test(body)
  }

  parse(body: string, _receivedAt: Date): ParseResult {
    const text = body.replace(/\r\n/g, '\n')
    const partial: Partial<ParsedOrder> = { source: 'RAJBHOG', outletName: 'RajBhog Khana' }

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
        source: 'RAJBHOG',
        externalOrderId: orderId,
        outletName: 'RajBhog Khana',
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

  /** "04 Sep 2026, 23:00" — unlike most aggregators, carries its own year. */
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
   * Whitespace-columned rows between the "SL# Item Description ..." header
   * and "Subtotal:". Columns are split on runs of 2+ spaces; qty/price/GST/
   * amount are read from the tail so a description that happens to contain
   * a double space doesn't shift them.
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

      const cols = line.split(/\s{2,}/).filter(Boolean)
      if (cols.length < 5) continue
      const qty = Number(cols[cols.length - 4])
      if (!Number.isFinite(qty) || qty <= 0) continue
      items.push({ name: cols[1].trim(), qty, notes: null })
    }
    return items
  }
}
