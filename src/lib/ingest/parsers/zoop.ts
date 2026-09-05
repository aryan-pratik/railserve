import type { OrderParser, ParseResult, ParsedOrder } from '../types'
import { MONTHS, looksLikePhone, normalisePaymentMode, rupeeStringToPaise } from './shared'

/**
 * Zoop parser. A generated "Order Confirmation" mail with a tab-separated
 * label/value table, two fields per row:
 *
 *   ZOOP Txn. No.	 : ZO261126325091995	 Type	 : Prepaid
 *   Customer Name	 : Ram milan	 Phone	 : 9335342078
 *   Train	 : Pnvl Gkp Express/ 15066	 Coach/ Seat	 : S1/ 61
 *   Restaurants Name	 : (3749) The Cosmozin Lounge	 ETA	 : 05-Sep-2026 15:06
 *   At	 : Kanpur Central/ CNB	 Delivery Date	 : 05-Sep-2026 15:06
 *
 *   Item Name	 Price	 Quantity	 Amount
 *   Paneer Biryani n Raita Combo	 199	 1	 199
 *   Base Price Total	 ₹ 199
 *   ...
 *   Order Total	 ₹ 259
 *
 * Zoop is a multi-vendor aggregator (unlike RajBhog, which is its own single
 * kitchen) — the outlet is parsed per-order from "Restaurants Name", the same
 * way YatriRestro reads its "Outlet Name" field, and must still resolve via
 * matchOutlet() against a real Restaurant record. "Restaurants Name" carries
 * a leading "(3749) " outlet-id that isn't part of the restaurant's name.
 *
 * Field values are read up to the next tab OR newline (`[^\t\n]+`) rather
 * than to end-of-line, since two fields share a line.
 */
export class ZoopParser implements OrderParser {
  readonly source = 'ZOOP' as const

  matches(body: string): boolean {
    return /ZOOP\s*Txn\.?\s*No\.?\s*:/i.test(body) && /Zoop\s+Web\s+Services/i.test(body)
  }

  parse(body: string, _receivedAt: Date): ParseResult {
    const text = body.replace(/\r\n/g, '\n')
    const partial: Partial<ParsedOrder> = { source: 'ZOOP' }

    const field = (label: string): string | null => {
      const re = new RegExp(`\\b${label}\\s*:\\s*([^\\t\\n]+)`, 'i')
      const v = re.exec(text)?.[1]?.trim()
      return v || null
    }

    const orderId = field('ZOOP\\s*Txn\\.?\\s*No\\.?')
    if (!orderId) {
      return { ok: false, reason: 'PARSE_FAILED', detail: 'no ZOOP txn number found', partial }
    }
    partial.externalOrderId = orderId

    const outletRaw = field('Restaurants\\s*Name')
    const outletName = outletRaw ? outletRaw.replace(/^\(\d+\)\s*/, '').trim() : null
    if (!outletName) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'outlet name missing', partial }
    }
    partial.outletName = outletName

    // "Kanpur Central/ CNB" — code is the trailing segment after the slash.
    const atRaw = field('At')
    const stationMatch = atRaw ? /^(.+)\/\s*([A-Za-z]{2,5})$/.exec(atRaw) : null
    if (!stationMatch) {
      return {
        ok: false, reason: 'MISSING_FIELD',
        detail: `station code not parseable from ${JSON.stringify(atRaw)}`, partial,
      }
    }
    const stationName = stationMatch[1].trim() || null
    const stationCode = stationMatch[2].trim().toUpperCase()
    partial.stationName = stationName
    partial.stationCode = stationCode

    // "Pnvl Gkp Express/ 15066" — name first, unlike RajBhog's "12590 / NAME".
    const trainRaw = field('Train')
    const trainMatch = trainRaw ? /^(.+?)\/\s*(\d{3,6})$/.exec(trainRaw) : null
    const trainName = trainMatch?.[1]?.trim() || null
    const trainNo = trainMatch?.[2] ?? null

    const seatRaw = field('Coach\\/\\s*Seat')
    const seatMatch = seatRaw ? /^(\S+)\s*\/\s*(\S+)$/.exec(seatRaw) : null
    const coach = seatMatch?.[1]?.toUpperCase() ?? null
    const berth = seatMatch?.[2] ?? null
    const rawSeat = coach && berth ? `${coach}-${berth}` : null

    const contactName = field('Customer\\s*Name')
    const phoneRaw = field('Phone')
    const contactPhone =
      phoneRaw && looksLikePhone(phoneRaw) ? phoneRaw.replace(/\D/g, '').slice(-10) : null

    const scheduledArrival = this.parseDeliveryDate(field('Delivery\\s*Date'))

    const items = this.parseItems(text)
    if (items.length === 0) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'no order items found', partial }
    }

    const totalMatch = /\bOrder\s*Total\b[^\d₹]*₹\s*([\d,]+(?:\.\d+)?)/i.exec(text)
    const amountPaise = totalMatch ? rupeeStringToPaise(totalMatch[1]) : null
    if (amountPaise === null) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'order total missing or unparseable', partial }
    }

    const payRaw = field('Type')
    const paymentMode = payRaw ? normalisePaymentMode(payRaw) : null

    return {
      ok: true,
      order: {
        source: 'ZOOP',
        externalOrderId: orderId,
        outletName,
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

  /** "05-Sep-2026 15:06" — carries its own year, like RajBhog's delivery date. */
  private parseDeliveryDate(raw: string | null): Date | null {
    if (!raw) return null
    const m = /(\d{1,2})-([A-Za-z]{3})[A-Za-z]*-(\d{4})\s+(\d{1,2}):(\d{2})/.exec(raw)
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
   * Tab-separated rows between the "Item Name  Price  Quantity  Amount"
   * header and the "Base Price Total" line.
   */
  private parseItems(text: string): { name: string; qty: number; notes: string | null }[] {
    const lines = text.split('\n')
    const headerIdx = lines.findIndex(
      (l) => /Item\s*Name/i.test(l) && /Price/i.test(l) && /Quantity/i.test(l),
    )
    if (headerIdx < 0) return []

    const items: { name: string; qty: number; notes: string | null }[] = []
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue
      if (/^Base\s*Price\s*Total/i.test(line)) break

      const cols = line.split('\t').map((c) => c.trim()).filter(Boolean)
      if (cols.length < 4) continue
      const qty = Number(cols[2])
      if (!Number.isFinite(qty) || qty <= 0) continue
      items.push({ name: cols[0], qty, notes: null })
    }
    return items
  }
}
