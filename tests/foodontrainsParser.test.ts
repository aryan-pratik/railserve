import { describe, expect, it } from 'vitest'
import { PARSERS } from '../src/lib/ingest'
import { FoodOnTrainsParser } from '../src/lib/ingest/parsers/foodontrains'
import * as fx from './fixtures/foodontrains'

const parser = new FoodOnTrainsParser()
const RECEIVED = new Date('2026-10-25T15:00:00Z')

const EXPECTED = {
  source: 'FOODONTRAINS',
  externalOrderId: 'FT-577998',
  outletName: 'FoodOnTrains',
  stationName: 'Kanpur Central',
  stationCode: 'CNB',
  contactName: 'Gautam',
  contactPhone: '9821244895',
  trainNo: '02564',
  trainName: 'NDLS BJU SPL',
  coach: 'VA',
  berth: '34',
  rawSeat: 'VA-34',
  amountPaise: 65100,
  paymentMode: 'COD',
}

describe('FoodOnTrains parser', () => {
  it.each([
    ['pasted', fx.SAMPLE_PASTED],
    ['Gmail-flattened', fx.SAMPLE_GMAIL],
  ])('parses the %s sample order', (_label, body) => {
    const r = parser.parse(body, RECEIVED)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.order).toMatchObject(EXPECTED)
    expect(r.order.items).toEqual([
      { name: 'veg pizza 1', qty: 2, notes: null },
      { name: 'veg thali 1', qty: 1, notes: null },
    ])
    // 25 Oct, 11:50 pm IST
    expect(r.order.scheduledArrival?.toISOString()).toBe('2026-10-25T18:20:00.000Z')
  })

  it('reads 12 am as midnight and a prepaid order as PREPAID', () => {
    const body = fx.SAMPLE_PASTED
      .replace('25 Oct, 11:50 pm', '26 Oct, 12:15 am')
      .replace('Collect ₹651 in cash at the seat', 'Paid online · nothing to collect')
    const r = parser.parse(body, RECEIVED)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.order.scheduledArrival?.toISOString()).toBe('2026-10-25T18:45:00.000Z')
    expect(r.order.paymentMode).toBe('PREPAID')
  })

  it('refuses an order with no items', () => {
    const body = fx.SAMPLE_PASTED.replace(/Items[\s\S]*?(?=Station)/, '')
    const r = parser.parse(body, RECEIVED)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('MISSING_FIELD')
  })

  describe('plain-text mail', () => {
    const RECEIVED_PLAIN = new Date('2026-10-26T09:00:00Z')

    it('parses the documented sample', () => {
      const r = parser.parse(fx.SAMPLE_PLAIN, RECEIVED_PLAIN)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.order).toMatchObject({
        source: 'FOODONTRAINS',
        externalOrderId: 'FT-123456',
        outletName: 'Zaika',
        stationName: 'Kanpur Central',
        stationCode: 'CNB',
        contactName: 'Suman Ray',
        contactPhone: '7001573488',
        trainNo: '12002',
        trainName: 'Bhopal Shatabdi',
        coach: 'B4',
        berth: '11',
        rawSeat: 'B4-11',
        amountPaise: 46000,
        paymentMode: 'COD',
      })
      expect(r.order.items).toEqual([
        { name: 'Aalu Paratha Combo', qty: 2, notes: null },
        { name: 'Sweet Lassi', qty: 1, notes: null },
      ])
      // 26 Oct, 03:09 pm IST
      expect(r.order.scheduledArrival?.toISOString()).toBe('2026-10-26T09:39:00.000Z')
    })

    it('takes the stated delay off the expected arrival', () => {
      const late = (suffix: string) =>
        parser.parse(fx.SAMPLE_PLAIN.replace('03:09 pm', `03:09 pm ${suffix}`), RECEIVED_PLAIN)
      const at = (r: ReturnType<typeof late>) => (r.ok ? r.order.scheduledArrival?.toISOString() : null)
      expect(at(late('(running 59 min late)'))).toBe('2026-10-26T08:40:00.000Z')
      expect(at(late('(running 1 hr 5 min late)'))).toBe('2026-10-26T08:34:00.000Z')
    })

    it('reads a prepaid order and Indian digit grouping', () => {
      const body = fx.SAMPLE_PLAIN
        .replace('Collect ₹460 in cash at the seat', 'Paid online ₹1,250, nothing to collect')
        .replace('Order total: ₹460 (items ₹438 + GST ₹22)', 'Order total: ₹1,250 (items ₹1,190 + GST ₹60)')
      const r = parser.parse(body, RECEIVED_PLAIN)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.order.paymentMode).toBe('PREPAID')
      expect(r.order.amountPaise).toBe(125000)
    })

    it('ignores labels it does not know, including one that looks like an item row', () => {
      const body = fx.SAMPLE_PLAIN
        .replace('Order ID:', 'Free gift: 1 x Papad ₹0\nOrder ID:')
        .replace('Station:', 'Platform: 4\nStation:')
      const r = parser.parse(body, RECEIVED_PLAIN)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.order.items.map((i) => i.name)).toEqual(['Aalu Paratha Combo', 'Sweet Lassi'])
      expect(r.order.stationCode).toBe('CNB')
    })

    it('prefers the Order ID label to the header', () => {
      const body = fx.SAMPLE_PLAIN.replace('New order FT-123456', 'New order FT-999999')
      const r = parser.parse(body, RECEIVED_PLAIN)
      expect(r.ok && r.order.externalOrderId).toBe('FT-123456')
    })
  })

  it('rejects an unrelated email', () => {
    expect(parser.matches('some unrelated email')).toBe(false)
  })

  it.each([
    ['pasted', fx.SAMPLE_PASTED],
    ['Gmail-flattened', fx.SAMPLE_GMAIL],
    ['plain-text', fx.SAMPLE_PLAIN],
  ])('is the parser PARSERS dispatches the %s sample to', (_label, body) => {
    expect(PARSERS.find((x) => x.matches(body))).toBeInstanceOf(FoodOnTrainsParser)
  })
})
