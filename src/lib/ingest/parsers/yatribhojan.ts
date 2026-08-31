import type { OrderParser, ParseResult, ParsedOrder } from '../types'
import { looksLikePhone, normalisePaymentMode, rupeeStringToPaise } from './shared'

/**
 * Yatribhojan order parser (vendors@yatribhojan.com). Colon-delimited fields
 * between `-----` dividers, e.g.:
 *
 *   ORDER NO: 57606971
 *   PAYMODE: COD
 *   -----
 *   DELIVERY: 31-08-2026, ETA: 14:10
 *   STATION: KANPUR CENTRAL (CNB)
 *   TRAIN: 12488, SEEMANCHAL EXP
 *   COACH: B2, SEAT: 59
 *
 * A distinct vendor from YatriRestro — same-sounding name, unrelated format.
 */
export class YatribhojanParser implements OrderParser {
  readonly source = 'YATRIBHOJAN' as const

  matches(body: string): boolean {
    return /TEAM\s*YATRIBHOJAN/i.test(body) || /YATRIBHOJAN/i.test(body)
  }

  parse(body: string, receivedAt: Date): ParseResult {
    const text = body.replace(/\r\n/g, '\n')
    const partial: Partial<ParsedOrder> = { source: 'YATRIBHOJAN' }

    const field = (label: string): string | null => {
      const re = new RegExp(`^${label}\\s*:\\s*(.+)$`, 'im')
      const m = re.exec(text)
      return m ? m[1].trim() : null
    }

    const orderId = field('ORDER\\s*NO') ?? null
    if (!orderId) {
      return { ok: false, reason: 'PARSE_FAILED', detail: 'no order id found', partial }
    }
    partial.externalOrderId = orderId

    // No outlet field in this format — vendor sends from a single kitchen,
    // signed "TEAM YATRIBHOJAN". Same fixed name every time. Matches the
    // outlet as registered in Setup: "Yatri Bhojan" (with a space).
    const outletName = 'Yatri Bhojan'
    partial.outletName = outletName

    const stationRaw = field('STATION')
    const stationMatch = stationRaw ? /^(.*?)\s*\(([A-Z]{2,5})\)$/.exec(stationRaw) : null
    if (!stationMatch) {
      return {
        ok: false, reason: 'MISSING_FIELD',
        detail: `station code not parseable from ${JSON.stringify(stationRaw)}`, partial,
      }
    }
    partial.stationName = stationMatch[1].trim() || null
    partial.stationCode = stationMatch[2].toUpperCase()

    const trainRaw = field('TRAIN')
    const trainMatch = trainRaw ? /^(\d{4,5})\s*,\s*(.+)$/.exec(trainRaw) : null
    const trainNo = trainMatch?.[1] ?? null
    const trainName = trainMatch?.[2]?.trim() ?? null

    const coachSeatRaw = field('COACH')
    const coachSeatMatch = coachSeatRaw
      ? /^([A-Z]+\d*)\s*,\s*SEAT\s*:\s*(\d+)$/i.exec(coachSeatRaw)
      : null
    const coach = coachSeatMatch?.[1] ?? null
    const berth = coachSeatMatch?.[2] ?? null
    const rawSeat = coach && berth ? `${coach}-${berth}` : coachSeatRaw

    const scheduledArrival = this.parseDelivery(field('DELIVERY'))

    const items = this.parseItems(text)
    if (items.length === 0) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'no order items found', partial }
    }

    const amountRaw = field('NET\\s*TOTAL')
    const amountMatch = amountRaw ? /Rs\.?\s*([\d.,]+)/i.exec(amountRaw) : null
    const amountPaise = amountMatch ? rupeeStringToPaise(amountMatch[1]) : null
    if (amountPaise === null) {
      return { ok: false, reason: 'MISSING_FIELD', detail: 'net total missing or unparseable', partial }
    }

    const paymodeRaw = field('PAYMODE')
    const paymentMode = paymodeRaw ? normalisePaymentMode(paymodeRaw) : null

    const phoneRaw = field('MOB')
    const contactPhone =
      phoneRaw && looksLikePhone(phoneRaw) ? phoneRaw.replace(/\D/g, '').slice(-10) : null
    const contactName = field('NAME')

    return {
      ok: true,
      order: {
        source: 'YATRIBHOJAN',
        externalOrderId: orderId,
        outletName,
        stationName: partial.stationName ?? null,
        stationCode: partial.stationCode!,
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

  /** "31-08-2026, ETA: 14:10" (DD-MM-YYYY, HH:MM) in IST — unlike other aggregators, carries its own year. */
  private parseDelivery(raw: string | null): Date | null {
    if (!raw) return null
    const m = /(\d{1,2})-(\d{1,2})-(\d{4}).*?(\d{1,2}):(\d{2})/.exec(raw)
    if (!m) return null

    const [, dayStr, monthStr, yearStr, hourStr, minuteStr] = m
    const day = Number(dayStr)
    const month = Number(monthStr)
    const year = Number(yearStr)
    const hour = Number(hourStr)
    const minute = Number(minuteStr)
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null

    const iso =
      `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` +
      `T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+05:30`
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? null : d
  }

  /** Lines between a `****` divider pair under ITEM DETAILS, e.g. "Veg Biryani With Raita Combo X 1". */
  private parseItems(text: string): { name: string; qty: number; notes: string | null }[] {
    const lines = text.split('\n').map((l) => l.trim())
    const start = lines.findIndex((l) => /^\*{3,}$/.test(l))
    if (start < 0) return []
    const end = lines.findIndex((l, i) => i > start && /^\*{3,}$/.test(l))
    if (end < 0) return []

    const items: { name: string; qty: number; notes: string | null }[] = []
    for (let i = start + 1; i < end; i++) {
      const line = lines[i]
      if (!line) continue
      const m = /^(.+?)\s*X\s*(\d+)$/i.exec(line)
      if (m) {
        items.push({ name: m[1].trim(), qty: Number(m[2]), notes: null })
      }
    }
    return items
  }
}
