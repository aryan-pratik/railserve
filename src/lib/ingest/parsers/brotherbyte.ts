import type { OrderParser, ParseResult, ParsedOrder } from '../types'
import { looksLikePhone, normalisePaymentMode, rupeeStringToPaise } from './shared'

/**
 * BrotherByte parser. A WhatsApp-style message, label-and-colon fields with
 * values wrapped in `*bold*` markers:
 *
 *   Dear *The Cosmozin Lounge*,
 *   New Order No: *1*
 *
 *   Order ID: *BB00101303/2485257102*
 *   Train: *12323/HWH BME EXP*
 *   Delivery Station: *KANPUR CENTRAL (CNB)*
 *   Delivery Date & Time: *09-12-2026 09:10 IST*
 *   Coach & Berth: *B5/66*
 *   Customer: *ABHISHEK VAISNAV*
 *   Phone: *7984434724*
 *
 *   *Order Items:*
 *   *1-Chicken Biryani With Raita Combo (non-veg) - Chicken Biryani 2pcs, Raita, ...*
 *
 *   Payment Method: *Cash On Delivery*
 *   Order Total: *243.60*
 *   Amount to Collect: *244*
 *
 * Multi-vendor aggregator — the outlet greets by name ("Dear *Outlet*,")
 * rather than carrying a fixed vendor, so it still resolves via matchOutlet().
 *
 * Order ID carries two ids separated by a slash — BrotherByte's own ("BB...")
 * and, after the slash, an IRCTC-style numeric order id, same treatment as
 * RajBhog's "Invoice RBK.../ numeric" line: the numeric half is externalOrderId.
 */
export class BrotherByteParser implements OrderParser {
  readonly source = 'BROTHERBYTE' as const

  matches(body: string): boolean {
    return /BrotherByte/i.test(body) && /Order\s*ID\s*:/i.test(body)
  }

  parse(body: string, _receivedAt: Date): ParseResult {
    const text = body.replace(/\r\n/g, '\n')
    const partial: Partial<ParsedOrder> = { source: 'BROTHERBYTE' }

    const field = (label: string): string | null => {
      const re = new RegExp(`${label}\\s*:\\s*\\*?([^*\\n]+)\\*?`, 'i')
      const m = re.exec(text)
      if (!m) return null
      const v = m[1].trim()
      return v || null
    }

    const outletName = /Dear\s+\*(.+?)\*/i.exec(text)?.[1]?.trim() ?? null
    if (!outletName) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'outlet name missing', partial }
    }
    partial.outletName = outletName

    const orderIdRaw = field('Order\\s*ID')
    const orderIdMatch = orderIdRaw ? /\/(\d+)$/.exec(orderIdRaw) : null
    if (!orderIdMatch) {
      return { ok: false, reason: 'PARSE_FAILED', detail: 'no order id found', partial }
    }
    const orderId = orderIdMatch[1]
    partial.externalOrderId = orderId

    const stationRaw = field('Delivery\\s*Station')
    const stationMatch = stationRaw ? /^(.+?)\s*\(([A-Za-z]{2,5})\)$/.exec(stationRaw) : null
    if (!stationMatch) {
      return {
        ok: false, reason: 'MISSING_FIELD',
        detail: `station code not parseable from ${JSON.stringify(stationRaw)}`, partial,
      }
    }
    const stationName = stationMatch[1].trim() || null
    const stationCode = stationMatch[2].toUpperCase()
    partial.stationName = stationName
    partial.stationCode = stationCode

    const trainRaw = field('Train')
    const trainMatch = trainRaw ? /^(\d{3,6})\/(.+)$/.exec(trainRaw) : null
    const trainNo = trainMatch?.[1] ?? null
    const trainName = trainMatch?.[2]?.trim() || null

    const seatRaw = field('Coach\\s*&\\s*Berth')
    const seatMatch = seatRaw ? /^(\S+)\/(\S+)$/.exec(seatRaw) : null
    const coach = seatMatch?.[1]?.toUpperCase() ?? null
    const berth = seatMatch?.[2] ?? null
    const rawSeat = coach && berth ? `${coach}-${berth}` : null

    const contactName = field('Customer')
    const phoneRaw = field('Phone')
    const contactPhone =
      phoneRaw && looksLikePhone(phoneRaw) ? phoneRaw.replace(/\D/g, '').slice(-10) : null

    const scheduledArrival = this.parseDeliveryDate(field('Delivery\\s*Date\\s*&\\s*Time'))

    const items = this.parseItems(text)
    if (items.length === 0) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'no order items found', partial }
    }

    const totalRaw = field('Order\\s*Total')
    const amountPaise = totalRaw ? rupeeStringToPaise(totalRaw) : null
    if (amountPaise === null) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'order total missing or unparseable', partial }
    }

    const payRaw = field('Payment\\s*Method')
    const paymentMode = payRaw ? normalisePaymentMode(payRaw.replace(/\s+/g, '_')) : null

    return {
      ok: true,
      order: {
        source: 'BROTHERBYTE',
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

  /** "09-12-2026 09:10 IST" (DD-MM-YYYY, HH:MM) — carries its own year. */
  private parseDeliveryDate(raw: string | null): Date | null {
    if (!raw) return null
    const m = /(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})/.exec(raw)
    if (!m) return null

    const day = Number(m[1])
    const month = Number(m[2])
    const year = Number(m[3])
    const hour = Number(m[4])
    const minute = Number(m[5])
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null

    const iso =
      `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` +
      `T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+05:30`
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? null : d
  }

  /**
   * Lines between "*Order Items:*" and "Payment Method:", each shaped
   * "*<index>-<name> - <notes>*". The index is BrotherByte's own line
   * numbering, not a quantity, so every line here is a single unit.
   */
  private parseItems(text: string): { name: string; qty: number; notes: string | null }[] {
    const lines = text.split('\n').map((l) => l.trim())
    const start = lines.findIndex((l) => /^\*Order\s*Items\s*:?\*$/i.test(l))
    if (start < 0) return []

    const items: { name: string; qty: number; notes: string | null }[] = []
    for (let i = start + 1; i < lines.length; i++) {
      const line = lines[i]
      if (!line) continue
      if (/^Payment\s*Method\s*:/i.test(line)) break

      const m = /^\*\d+-(.+?)\s-\s(.+)\*$/.exec(line)
      if (m) {
        items.push({ name: m[1].trim(), qty: 1, notes: m[2].trim() || null })
      }
    }
    return items
  }
}
