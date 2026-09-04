import { describe, expect, it } from 'vitest'
import { PARSERS } from '../src/lib/ingest'
import { RajBhogParser } from '../src/lib/ingest/parsers/rajbhog'
import * as fx from './fixtures/rajbhog'

const parser = new RajBhogParser()
const RECEIVED = new Date('2026-09-04T14:00:00Z')

describe('RajBhog parser', () => {
  it('parses a real sample order', () => {
    const r = parser.parse(fx.SAMPLE_1, RECEIVED)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.order).toMatchObject({
      source: 'RAJBHOG',
      externalOrderId: '2482879979',
      outletName: 'RajBhog Khana',
      stationName: 'KANPUR CENTRAL',
      stationCode: 'CNB',
      contactName: 'Shivam',
      contactPhone: '9931469044',
      trainNo: '12590',
      trainName: 'CHZ GKP SF EXP',
      coach: 'B7',
      berth: '10',
      rawSeat: 'B7-10',
      amountPaise: 25400,
      paymentMode: 'PREPAID',
    })
    expect(r.order.items).toEqual([{ name: 'VEG MAHARAJA THALI', qty: 1, notes: null }])
    // 04 Sep 2026, 23:00 IST
    expect(r.order.scheduledArrival?.toISOString()).toBe('2026-09-04T17:30:00.000Z')
  })

  it('parses a second real sample order', () => {
    const r = parser.parse(fx.SAMPLE_2, RECEIVED)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.order).toMatchObject({
      externalOrderId: '2482820125',
      contactName: 'Saurav kumar',
      contactPhone: '9693721072',
      trainNo: '22406',
      trainName: 'BGP GARIB RATH',
      coach: 'G15',
      berth: '33',
      rawSeat: 'G15-33',
      amountPaise: 19700,
      paymentMode: 'PREPAID',
    })
    expect(r.order.items).toEqual([
      { name: 'VEG MANCHURIAN WITH NOODLES COMBO', qty: 1, notes: null },
    ])
    // 04 Sep 2026, 22:12 IST
    expect(r.order.scheduledArrival?.toISOString()).toBe('2026-09-04T16:42:00.000Z')
  })

  it('rejects an unrelated email', () => {
    expect(parser.matches('some unrelated email')).toBe(false)
  })

  it('is the parser PARSERS dispatches a real sample to', () => {
    const p = PARSERS.find((x) => x.matches(fx.SAMPLE_1))
    expect(p).toBeInstanceOf(RajBhogParser)
  })
})
