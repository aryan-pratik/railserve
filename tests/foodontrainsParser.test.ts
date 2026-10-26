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

  it('rejects an unrelated email', () => {
    expect(parser.matches('some unrelated email')).toBe(false)
  })

  it.each([
    ['pasted', fx.SAMPLE_PASTED],
    ['Gmail-flattened', fx.SAMPLE_GMAIL],
  ])('is the parser PARSERS dispatches the %s sample to', (_label, body) => {
    expect(PARSERS.find((x) => x.matches(body))).toBeInstanceOf(FoodOnTrainsParser)
  })
})
