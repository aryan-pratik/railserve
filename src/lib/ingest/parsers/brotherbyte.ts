import type { OrderParser, ParseResult, ParsedOrder } from '../types'
import { looksLikePhone, normalisePaymentMode, rupeeStringToPaise } from './shared'

/**
 * BrotherByte parser. A generated "order confirmed" mail — an HTML table
 * (label cell, value cell) that comes through as tab-separated label/value
 * lines once converted to plain text, e.g.:
 *
 *   Dear The Cosmozin Lounge,
 *
 *   A new order has been confirmed for your outlet.
 *
 *   Order ID	BB00101304/2485260978
 *   Train	12323/HWH BME EXP
 *   Station	KANPUR CENTRAL (CNB)
 *   Delivery Date & ETA	09-12-2026 09:10 IST
 *   Coach & Berth	B5/66
 *   Customer	ABHISHEK VAISNAV (7984434724)
 *   Items	1-Amritsari Thali (veg) - Matar Paneer, Chole, Dal Tadka, ...
 *   Payment Method	Cash On Delivery
 *   Order Total	₹213.15
 *   GST/Tax	₹10.15
 *   Discount	₹0
 *   Outlet Discount	₹0
 *   Amount to Collect	₹213
 *   Customer Notes	Provide Good food
 *   Regards,
 *   Team BrotherByte
 *
 * No colons and no bold markers — an earlier revision of this parser assumed
 * a WhatsApp-style "Label: *value*" layout from a hand-typed sample, which
 * does not match the real mail. `field()` accepts a colon OR a run of 2+
 * whitespace characters as the separator (see SEP below), so either layout
 * still parses, whether the real whitespace turns out to be a literal tab
 * or a multi-space gutter left behind by flattening an HTML table.
 *
 * Multi-vendor aggregator — the outlet greets by name ("Dear Outlet,")
 * rather than carrying a fixed vendor, so it still resolves via matchOutlet().
 *
 * Order ID carries two ids separated by a slash — BrotherByte's own ("BB...")
 * and, after the slash, an IRCTC-style numeric order id, same treatment as
 * RajBhog's "Invoice RBK.../ numeric" line: the numeric half is externalOrderId.
 *
 * Customer name and phone arrive as one field, "NAME (PHONE)", rather than
 * two separate fields.
 */
// Label/value separator: a colon (with optional surrounding spaces), a
// single tab, or two or more whitespace characters run together (the
// multi-space gutter an HTML table leaves behind once flattened to plain
// text) — the mail's actual whitespace hasn't been consistent between
// samples, and real mail has shown up with just one tab between label and
// value, which \s{2,} alone does not cover. A single plain space does NOT
// count, on purpose: it's what separates the words of a two-word label like
// "Customer Notes" from each other, and treating it as a field separator
// would make field('Customer') match that line instead of the real
// "Customer" line.
const SEP = '(?:\\s*:\\s*|\\s{2,}|\\t+)'

export class BrotherByteParser implements OrderParser {
  readonly source = 'BROTHERBYTE' as const

  matches(body: string): boolean {
    return /BrotherByte/i.test(body) && /Order\s*ID/i.test(body)
  }

  parse(body: string, _receivedAt: Date): ParseResult {
    const text = body.replace(/\r\n/g, '\n')
    const partial: Partial<ParsedOrder> = { source: 'BROTHERBYTE' }

    // Leading whitespace before the label is allowed — the real mail
    // indents every row of its label/value table.
    const field = (label: string): string | null => {
      const re = new RegExp(`^\\s*\\*?${label}${SEP}\\*?(.+?)\\*?$`, 'im')
      const m = re.exec(text)
      if (!m) return null
      const v = m[1].trim()
      return v || null
    }

    const outletName = /Dear\s+\*?(.+?)\*?,/i.exec(text)?.[1]?.trim() ?? null
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

    const stationRaw = field('(?:Delivery\\s*)?Station')
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

    // "ABHISHEK VAISNAV (7984434724)" — name and phone in one field. Fall
    // back to a separate "Phone" field for the hand-typed layout, which
    // carries them apart.
    const customerRaw = field('Customer')
    const customerMatch = customerRaw ? /^(.+?)\s*\(([^()]+)\)$/.exec(customerRaw) : null
    const contactName = (customerMatch ? customerMatch[1] : customerRaw)?.trim() || null
    const phoneRaw = customerMatch ? customerMatch[2] : field('Phone')
    const contactPhone =
      phoneRaw && looksLikePhone(phoneRaw) ? phoneRaw.replace(/\D/g, '').slice(-10) : null

    const scheduledArrival = this.parseDeliveryDate(
      field('Delivery\\s*Date\\s*&\\s*(?:ETA|Time)'),
    )

    const items = this.parseItems(text)
    if (items.length === 0) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'no order items found', partial }
    }

    const totalRaw = field('Order\\s*Total')
    const amountPaise = totalRaw ? rupeeStringToPaise(totalRaw.replace(/[^\d.,]/g, '')) : null
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

  /**
   * "09-12-2026 09:10 IST" (MM-DD-YYYY, HH:MM) — carries its own year.
   * Confirmed against a real order dated the same day it was received:
   * unlike every other aggregator in this codebase, BrotherByte puts the
   * month first. A later real order instead arrived as "2026-09-12 17:40 IST"
   * (YYYY-MM-DD) — BrotherByte's own date format isn't consistent between
   * samples, so both are accepted; the leading 4-digit group is what tells
   * them apart.
   */
  private parseDeliveryDate(raw: string | null): Date | null {
    if (!raw) return null

    const isoFirst = /(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})/.exec(raw)
    const m = isoFirst ?? /(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})/.exec(raw)
    if (!m) return null

    const year = Number(isoFirst ? m[1] : m[3])
    const month = Number(isoFirst ? m[2] : m[1])
    const day = Number(isoFirst ? m[3] : m[2])
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
   * Items normally arrive inline on the "Items" line itself
   * ("Items<TAB>1-Name - notes"), one line per order in every real sample
   * seen so far. A hand-typed layout instead uses an "Order Items" header
   * line followed by one or more bulleted lines — supported too, since the
   * aggregator has no contract not to send several items that way. Either
   * shape, each item line is "<index>-<name> - <notes>"; the index is
   * BrotherByte's own numbering, not a quantity, so every line is one unit.
   */
  private parseItems(text: string): { name: string; qty: number; notes: string | null }[] {
    const lines = text.split('\n').map((l) => l.trim())
    const itemRe = /^\*?\d+-(.+?)\s-\s(.+?)\*?$/

    const items: { name: string; qty: number; notes: string | null }[] = []

    const inlineRe = new RegExp(`^Items${SEP}(.+)$`, 'i')
    const inlineIdx = lines.findIndex((l) => inlineRe.test(l))
    if (inlineIdx >= 0) {
      const inline = inlineRe.exec(lines[inlineIdx])?.[1] ?? ''
      const m = itemRe.exec(inline)
      if (m) items.push({ name: m[1].trim(), qty: 1, notes: m[2].trim() || null })
      return items
    }

    const headerIdx = lines.findIndex((l) => /^\*?Order\s*Items\s*:?\*?$/i.test(l))
    if (headerIdx < 0) return []

    const paymentMethodRe = new RegExp(`^Payment\\s*Method${SEP}`, 'i')
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const line = lines[i]
      if (!line) continue
      if (paymentMethodRe.test(line)) break

      const m = itemRe.exec(line)
      if (m) items.push({ name: m[1].trim(), qty: 1, notes: m[2].trim() || null })
    }
    return items
  }
}
