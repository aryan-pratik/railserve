import { describe, expect, it } from 'vitest'
import { YatriRestroParser } from '../src/lib/ingest/parsers/yatriRestro'
import * as fx from './fixtures/yatriRestro'

const parser = new YatriRestroParser()
const RECEIVED = new Date('2026-08-27T08:00:00Z') // 13:30 IST, 27 Aug 2026

describe('YatriRestro parser', () => {
  it('produces exactly the output documented in plan §6', () => {
    const r = parser.parse(fx.SAMPLE_WITH_EMOJI, RECEIVED)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.order).toMatchObject({
      source: 'YATRIRESTRO',
      externalOrderId: '1000584805',
      outletName: 'HOTEL GANGA GALAXY',
      stationName: 'KANPUR CENTRAL',
      stationCode: 'CNB',
      contactName: 'Neelesh Soni',
      contactPhone: '9752446747',
      trainNo: '12506',
      trainName: 'NORTH EAST EXP',
      coach: 'B5',
      berth: '37',
      rawSeat: 'B5-37',
      amountPaise: 23600,
      paymentMode: 'COD',
    })
    expect(r.order.items).toEqual([
      { name: 'Paneer Paratha With Curd Combo', qty: 1, notes: null },
    ])
    // 27-Aug 13:25 IST
    expect(r.order.scheduledArrival?.toISOString()).toBe('2026-08-27T07:55:00.000Z')
  })

  it('parses identically when the emoji have been stripped', () => {
    const withEmoji = parser.parse(fx.SAMPLE_WITH_EMOJI, RECEIVED)
    const without = parser.parse(fx.SAMPLE_NO_EMOJI, RECEIVED)
    expect(withEmoji.ok && without.ok).toBe(true)
    if (!withEmoji.ok || !without.ok) return
    expect(without.order).toEqual(withEmoji.order)
  })

  it('loops over every item rather than matching once', () => {
    const r = parser.parse(fx.MULTI_ITEM, RECEIVED)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.order.items).toEqual([
      { name: 'Veg Thali', qty: 2, notes: null },
      { name: 'Masala Chai', qty: 3, notes: 'extra sugar' },
      { name: 'Mineral Water 1L', qty: 1, notes: null },
    ])
  })

  it('splits several items sharing one line', () => {
    const r = parser.parse(fx.MULTI_ITEM_SINGLE_LINE, RECEIVED)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.order.items).toEqual([
      { name: 'Aalu Paratha With Chole Combo', qty: 1, notes: null },
      { name: 'Paneer Paratha with Chhole Combo', qty: 2, notes: null },
    ])
  })

  it('keeps whatever follows the trailing pipe as an item note', () => {
    const r = parser.parse(fx.MULTI_ITEM, RECEIVED)
    if (!r.ok) throw new Error('expected parse to succeed')
    expect(r.order.items[1].notes).toBe('extra sugar')
  })

  it('handles a comma-grouped amount and a prepaid order', () => {
    const r = parser.parse(fx.MULTI_ITEM, RECEIVED)
    if (!r.ok) throw new Error('expected parse to succeed')
    expect(r.order.amountPaise).toBe(125050)
    expect(r.order.paymentMode).toBe('PREPAID')
  })

  it('takes the station code from the FINAL hyphen segment', () => {
    // "PRAYAGRAJ-JN-PRYJ" — a naive split would call the code "JN".
    const r = parser.parse(fx.ODD_SEAT_AND_STATION, RECEIVED)
    if (!r.ok) throw new Error('expected parse to succeed')
    expect(r.order.stationCode).toBe('PRYJ')
    expect(r.order.stationName).toBe('PRAYAGRAJ-JN')
  })

  it('keeps rawSeat when the seat does not split into coach and berth', () => {
    const r = parser.parse(fx.ODD_SEAT_AND_STATION, RECEIVED)
    if (!r.ok) throw new Error('expected parse to succeed')
    expect(r.order.rawSeat).toBe('GEN')
    expect(r.order.coach).toBe('GEN')
    expect(r.order.berth).toBeNull()
  })

  it('rolls the year forward for a December order in a January email', () => {
    // Plan §6 year inference: parsed date more than 7 days BEFORE the email
    // timestamp means it belongs to the following year.
    const received = new Date('2027-01-02T04:00:00Z') // 2 Jan 2027 IST
    const r = parser.parse(fx.ODD_SEAT_AND_STATION, received)
    if (!r.ok) throw new Error('expected parse to succeed')
    // 31-Dec 23:50 IST 2026, not 2027.
    expect(r.order.scheduledArrival?.toISOString()).toBe('2026-12-31T18:20:00.000Z')
  })

  it('rolls the year forward for a January service in a December email', () => {
    // The case plan §6 names explicitly: ordered 31 Dec 2026, train arrives
    // 06:30 on 1 Jan 2027.
    const received = new Date('2026-12-31T17:30:00Z') // 23:00 IST, 31 Dec 2026
    const r = parser.parse(fx.NEW_YEAR_CROSSING, received)
    if (!r.ok) throw new Error('expected parse to succeed')
    expect(r.order.scheduledArrival?.toISOString()).toBe('2027-01-01T01:00:00.000Z')
  })

  it('refuses to build a partial order when items are missing', () => {
    const r = parser.parse(fx.MALFORMED_NO_ITEMS, RECEIVED)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('MISSING_FIELD')
    expect(r.detail).toMatch(/items/i)
    // The partial is still carried so a human can see what was understood.
    expect(r.partial?.externalOrderId).toBe('1000585222')
  })

  it('rejects an unrelated email outright', () => {
    expect(parser.matches(fx.GARBAGE)).toBe(false)
    const r = parser.parse(fx.GARBAGE, RECEIVED)
    expect(r.ok).toBe(false)
  })

  it('recognises its own emails', () => {
    expect(parser.matches(fx.SAMPLE_WITH_EMOJI)).toBe(true)
    expect(parser.matches(fx.MULTI_ITEM)).toBe(true)
  })

  it('is deterministic', () => {
    const a = parser.parse(fx.SAMPLE_WITH_EMOJI, RECEIVED)
    const b = parser.parse(fx.SAMPLE_WITH_EMOJI, RECEIVED)
    expect(a).toEqual(b)
  })
})
