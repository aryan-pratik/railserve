import { describe, expect, it } from 'vitest'
import { PARSERS } from '../src/lib/ingest'
import { HomeBytesParser } from '../src/lib/ingest/parsers/homebytes'
import * as fx from './fixtures/homebytes'

const parser = new HomeBytesParser()
const RECEIVED = new Date('2026-09-14T03:00:00Z')

describe('HomeBytes parser', () => {
  it('parses a real sample order', () => {
    const r = parser.parse(fx.SAMPLE_1, RECEIVED)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.order).toMatchObject({
      source: 'HOMEBYTES',
      externalOrderId: '2486073972',
      outletName: 'HomeBytes',
      stationName: 'KANPUR CENTRAL',
      stationCode: 'CNB',
      contactName: 'Satvir',
      contactPhone: '9718488269',
      trainNo: '13051',
      trainName: 'NETAJI EXPRESS',
      coach: 'H1/G',
      berth: '19',
      rawSeat: 'H1/G-19',
      amountPaise: 25200,
      paymentMode: 'COD',
    })
    expect(r.order.items).toEqual([
      {
        name: 'Non Veg Mini Thali',
        qty: 1,
        notes:
          'Chicken curry  2pcs  +  Daal fry +  Jeera rice +  Tava roti  2pcs  +  Salad +  Pickle +  Gulab jamun +  Spoon +  Tissue paper',
      },
    ])
    // 14 Sep 2026, 13:30 IST
    expect(r.order.scheduledArrival?.toISOString()).toBe('2026-09-14T08:00:00.000Z')
  })

  it('rejects an unrelated email', () => {
    expect(parser.matches('some unrelated email')).toBe(false)
  })

  it('does not collide with RajBhog\'s near-identical template', () => {
    expect(parser.matches('Rajbhog Order Invoice        Booking Date: 04 Sep 2026, 21:49\nFSSAI NO.: 1')).toBe(false)
  })

  it('is the parser PARSERS dispatches a real sample to', () => {
    const p = PARSERS.find((x) => x.matches(fx.SAMPLE_1))
    expect(p).toBeInstanceOf(HomeBytesParser)
  })
})
