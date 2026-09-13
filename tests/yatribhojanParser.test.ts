import { describe, expect, it } from 'vitest'
import { PARSERS } from '../src/lib/ingest'
import { YatribhojanParser } from '../src/lib/ingest/parsers/yatribhojan'
import * as fx from './fixtures/yatribhojan'

const parser = new YatribhojanParser()
const RECEIVED = new Date('2026-08-31T05:00:00Z')

describe('Yatribhojan parser', () => {
  it('parses a real sample order with a plain coach', () => {
    const r = parser.parse(fx.SAMPLE_1, RECEIVED)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.order).toMatchObject({
      source: 'YATRIBHOJAN',
      externalOrderId: '57606971',
      outletName: 'Yatri Bhojan',
      stationName: 'KANPUR CENTRAL',
      stationCode: 'CNB',
      trainNo: '12488',
      trainName: 'SEEMANCHAL EXP',
      coach: 'B2',
      berth: '59',
      rawSeat: 'B2-59',
      contactName: 'Sonu Mehra',
      contactPhone: '9871234560',
      amountPaise: 15000,
      paymentMode: 'COD',
    })
    expect(r.order.items).toEqual([{ name: 'Veg Biryani With Raita Combo', qty: 1, notes: null }])
  })

  it('splits a RAC/WL booking-status prefix off the coach', () => {
    const r = parser.parse(fx.SAMPLE_RAC_COACH, RECEIVED)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.order).toMatchObject({
      coach: 'B2',
      berth: '39',
      rawSeat: 'RAC/B2-39',
    })
  })

  it('keeps an alphanumeric coach\'s "/sub-code" suffix instead of treating it as a booking status', () => {
    const r = parser.parse(fx.SAMPLE_ALPHANUMERIC_COACH, RECEIVED)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.order).toMatchObject({
      externalOrderId: '57614593',
      coach: 'H1/C',
      berth: '9',
      rawSeat: 'H1/C-9',
      contactName: 'Rupesh',
      contactPhone: '7858095122',
    })
  })

  it('keeps the alphanumeric coach suffix for a second real order too', () => {
    const r = parser.parse(fx.SAMPLE_ALPHANUMERIC_COACH_2, RECEIVED)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.order).toMatchObject({
      externalOrderId: '57615301',
      coach: 'H1/D',
      berth: '11',
      rawSeat: 'H1/D-11',
      contactName: 'Vivek',
      contactPhone: '8075771877',
    })
  })

  it('rejects an unrelated email', () => {
    expect(parser.matches('some unrelated email')).toBe(false)
  })

  it('is the parser PARSERS dispatches a real sample to', () => {
    const p = PARSERS.find((x) => x.matches(fx.SAMPLE_1))
    expect(p).toBeInstanceOf(YatribhojanParser)
  })
})
