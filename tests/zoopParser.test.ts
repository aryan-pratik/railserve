import { describe, expect, it } from 'vitest'
import { PARSERS } from '../src/lib/ingest'
import { ZoopParser } from '../src/lib/ingest/parsers/zoop'
import * as fx from './fixtures/zoop'

const parser = new ZoopParser()
const RECEIVED = new Date('2026-09-05T09:00:00Z')

describe('Zoop parser', () => {
  it('parses a real sample order', () => {
    const r = parser.parse(fx.SAMPLE_1, RECEIVED)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.order).toMatchObject({
      source: 'ZOOP',
      externalOrderId: 'ZO261126325091995',
      outletName: 'The Cosmozin Lounge',
      stationName: 'Kanpur Central',
      stationCode: 'CNB',
      contactName: 'Ram milan',
      contactPhone: '9335342078',
      trainNo: '15066',
      trainName: 'Pnvl Gkp Express',
      coach: 'S1',
      berth: '61',
      rawSeat: 'S1-61',
      amountPaise: 25900,
      paymentMode: 'PREPAID',
    })
    expect(r.order.items).toEqual([{ name: 'Paneer Biryani n Raita Combo', qty: 1, notes: null }])
    // 05-Sep-2026 15:06 IST
    expect(r.order.scheduledArrival?.toISOString()).toBe('2026-09-05T09:36:00.000Z')
  })

  it('rejects an unrelated email', () => {
    expect(parser.matches('some unrelated email')).toBe(false)
  })

  it('is the parser PARSERS dispatches a real sample to', () => {
    const p = PARSERS.find((x) => x.matches(fx.SAMPLE_1))
    expect(p).toBeInstanceOf(ZoopParser)
  })
})
