import { describe, expect, it } from 'vitest'
import { PARSERS } from '../src/lib/ingest'
import { BrotherByteParser } from '../src/lib/ingest/parsers/brotherbyte'
import * as fx from './fixtures/brotherbyte'

const parser = new BrotherByteParser()
const RECEIVED = new Date('2026-09-12T05:00:00Z')

describe('BrotherByte parser', () => {
  it('parses a real sample order', () => {
    const r = parser.parse(fx.SAMPLE_1, RECEIVED)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.order).toMatchObject({
      source: 'BROTHERBYTE',
      externalOrderId: '2485257102',
      outletName: 'The Cosmozin Lounge',
      stationName: 'KANPUR CENTRAL',
      stationCode: 'CNB',
      contactName: 'ABHISHEK VAISNAV',
      contactPhone: '7984434724',
      trainNo: '12323',
      trainName: 'HWH BME EXP',
      coach: 'B5',
      berth: '66',
      rawSeat: 'B5-66',
      amountPaise: 24360,
      paymentMode: 'COD',
    })
    expect(r.order.items).toEqual([
      {
        name: 'Chicken Biryani With Raita Combo (non-veg)',
        qty: 1,
        notes: 'Chicken Biryani 2pcs, Raita, Chilli Sauce, Tomato Sauce, Salad, Pickle, Gulab Jamun, Spoon, Tissue Paper',
      },
    ])
    // 09-12-2026 09:10 IST
    expect(r.order.scheduledArrival?.toISOString()).toBe('2026-12-09T03:40:00.000Z')
  })

  it('rejects an unrelated email', () => {
    expect(parser.matches('some unrelated email')).toBe(false)
  })

  it('is the parser PARSERS dispatches a real sample to', () => {
    const p = PARSERS.find((x) => x.matches(fx.SAMPLE_1))
    expect(p).toBeInstanceOf(BrotherByteParser)
  })
})
