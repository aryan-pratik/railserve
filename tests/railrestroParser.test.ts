import { describe, expect, it } from 'vitest'
import { PARSERS } from '../src/lib/ingest'
import { RailRestroParser } from '../src/lib/ingest/parsers/railrestro'
import * as fx from './fixtures/railrestro'

const parser = new RailRestroParser()
const RECEIVED = new Date('2026-09-25T09:00:00Z')

describe('RailRestro parser', () => {
  it('parses a real single-item order', () => {
    const r = parser.parse(fx.SAMPLE_1, RECEIVED)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.order).toMatchObject({
      source: 'RAILRESTRO',
      externalOrderId: '5920534',
      outletName: 'KHANA KHAZANA',
      contactName: 'Test Customer One',
      contactPhone: '9000000001',
      trainNo: '12817',
      trainName: 'SWARNJAYANTI EX',
      coach: 'B4',
      berth: '46',
      rawSeat: 'B4-46',
      // "Paid Total: Rs. 344.4", not the pre-GST "Total: Rs. 328".
      amountPaise: 34440,
      paymentMode: 'PREPAID',
    })
    expect(r.order.items).toEqual([{ name: 'Veg Mini Thali', qty: 2, notes: null }])
    // 2026-09-25 21:16 IST
    expect(r.order.scheduledArrival?.toISOString()).toBe('2026-09-25T15:46:00.000Z')
  })

  it('reports no station, because the mail carries none', () => {
    const r = parser.parse(fx.SAMPLE_1, RECEIVED)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // Not an oversight: RailRestro never names the delivery station, so the
    // station is resolved from the outlet instead. Asserted so that a future
    // "helpful" guess from the train or the seat fails loudly here.
    expect(r.order.stationCode).toBeNull()
    expect(r.order.stationName).toBeNull()
  })

  it('reads both items of a two-item order without double-counting the wrapped line totals', () => {
    const r = parser.parse(fx.SAMPLE_2, RECEIVED)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    // Each row's line total wraps onto its own "Rs. 213" line. Counting
    // columns rather than matching the row shape would yield four items.
    expect(r.order.items).toEqual([
      { name: 'Paneer Curry & Rice Combo', qty: 1, notes: null },
      { name: 'Chilli Paneer & Fried Rice Combo', qty: 1, notes: null },
    ])
    expect(r.order).toMatchObject({
      externalOrderId: '5921034',
      trainNo: '12308',
      trainName: 'JU HWH SF EXP',
      coach: 'S4',
      berth: '37',
    })
  })

  it('takes Paid Total even when a Discount and Final Total sit above it', () => {
    const r = parser.parse(fx.SAMPLE_2, RECEIVED)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // Subtotal is 447.3 and Total is 426 — both wrong answers to "what did
    // the customer pay". SAMPLE_1 has no Discount row at all, so this cannot
    // be found by counting rows from either end of the summary block.
    expect(r.order.amountPaise).toBe(42630)
  })

  it('marks an order COD when there is cash to collect', () => {
    const cod = fx.SAMPLE_1.replace('(Amount to collect)     Rs. 0/-', '(Amount to collect)     Rs. 344.4/-')
    const r = parser.parse(cod, RECEIVED)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.order.paymentMode).toBe('COD')
    // The amount owed does not change what the order is worth.
    expect(r.order.amountPaise).toBe(34440)
  })

  it('takes the first number when the customer has two', () => {
    const twoPhones = fx.SAMPLE_1.replace('M. 9000000001', 'M. 9630537343/9009937317')
    const r = parser.parse(twoPhones, RECEIVED)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.order.contactPhone).toBe('9630537343')
  })

  it('refuses an order it cannot price rather than inventing a total', () => {
    const noTotal = fx.SAMPLE_1
      .replace(/\s+Paid Total:\s+Rs\. 344\.4/, '')
      .replace(/\s+Subtotal:\s+Rs\. 344\.4/, '')
    const r = parser.parse(noTotal, RECEIVED)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('MISSING_FIELD')
    // The partial still carries enough to find the order in the inbox.
    expect(r.partial?.externalOrderId).toBe('5920534')
  })

  it('rejects an unrelated email', () => {
    expect(parser.matches('some unrelated email')).toBe(false)
  })

  it('does not match a bare brand mention with no order in it', () => {
    expect(parser.matches('Thanks for signing up with RailRestro. Your account is ready.')).toBe(false)
  })

  it('is not confused by YatriRestro, whose name also ends in Restro', () => {
    expect(parser.matches('YatriRestro order | ORDER #: 123')).toBe(false)
  })

  it('is the parser PARSERS dispatches both real samples to', () => {
    expect(PARSERS.find((p) => p.matches(fx.SAMPLE_1))).toBeInstanceOf(RailRestroParser)
    expect(PARSERS.find((p) => p.matches(fx.SAMPLE_2))).toBeInstanceOf(RailRestroParser)
  })
})
