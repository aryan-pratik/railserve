import { describe, expect, it } from 'vitest'
import { YatriRestroBookingParser } from '../src/lib/ingest/parsers/yatriRestroBooking'
import * as fx from './fixtures/yatriRestroBooking'

const parser = new YatriRestroBookingParser()
const RECEIVED = new Date('2026-08-31T08:00:00Z')

describe('YatriRestro booking-confirmation parser', () => {
  it('parses the real sample', () => {
    const r = parser.parse(fx.SAMPLE, RECEIVED)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.order).toMatchObject({
      source: 'YATRIRESTRO',
      externalOrderId: '1000085034',
      outletName: 'THE CHINESE HUB',
      stationName: 'PT.DEEN DAYAL UPADHYAYA JN.',
      stationCode: 'DDU',
      contactName: 'aman',
      contactPhone: '8789151114',
      trainNo: '22465',
      trainName: 'BABA B DHAM EXP',
      coach: 'A1',
      berth: '21',
      rawSeat: 'A1-21',
      amountPaise: 22700,
      paymentMode: 'COD',
      scheduledArrival: null,
    })
    expect(r.order.items).toEqual([
      { name: 'Chicken lollipop Fry 4pc', qty: 1, notes: '4pc' },
    ])
  })

  it('parses identically when cells are space-delimited instead of tab-delimited', () => {
    const tabbed = parser.parse(fx.SAMPLE, RECEIVED)
    const spaced = parser.parse(fx.SAMPLE_SPACE_DELIMITED, RECEIVED)
    expect(tabbed.ok && spaced.ok).toBe(true)
    if (!tabbed.ok || !spaced.ok) return
    expect(spaced.order).toEqual(tabbed.order)
  })

  it('loops over every item rather than matching once', () => {
    const r = parser.parse(fx.MULTI_ITEM, RECEIVED)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.order.items).toEqual([
      { name: 'Veg Thali', qty: 2, notes: null },
      { name: 'Masala Chai', qty: 3, notes: 'extra sugar' },
    ])
    expect(r.order.amountPaise).toBe(88725)
    expect(r.order.paymentMode).toBe('PREPAID')
  })

  it('takes the station code from the FIRST segment (code, then name)', () => {
    const r = parser.parse(fx.MULTI_ITEM, RECEIVED)
    if (!r.ok) throw new Error('expected parse to succeed')
    expect(r.order.stationCode).toBe('CNB')
    expect(r.order.stationName).toBe('KANPUR CENTRAL')
  })

  it('does not mistake an empty-valued label for the next row\'s value', () => {
    // DELIVERY DATE is blank in the real sample; COACH/BERTH must still
    // resolve to its own value rather than swallowing "COACH/BERTH" itself.
    const r = parser.parse(fx.SAMPLE, RECEIVED)
    if (!r.ok) throw new Error('expected parse to succeed')
    expect(r.order.coach).toBe('A1')
    expect(r.order.berth).toBe('21')
  })

  it('parses a delivery date of the form DD-MM-YYYY, HH:mm', () => {
    const r = parser.parse(fx.SAMPLE_WITH_DELIVERY_DATE, RECEIVED)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // 01-09-2026 11:19 IST = 05:49 UTC.
    expect(r.order.scheduledArrival?.toISOString()).toBe('2026-09-01T05:49:00.000Z')
  })

  it('recognises the "Order Confirmation" / "Dear Partner" template too', () => {
    expect(parser.matches(fx.SAMPLE_PARTNER_NO_OUTLET)).toBe(true)
  })

  it('defaults to the "YATRI RESTRO" outlet when the partner template names none', () => {
    // Interim business call: this template never states an outlet, so every
    // such order routes to the real "YATRI RESTRO" restaurant until there's a
    // way to tell which physical kitchen actually prepared it.
    const r = parser.parse(fx.SAMPLE_PARTNER_NO_OUTLET, RECEIVED)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.order).toMatchObject({
      externalOrderId: '1000591444',
      outletName: 'YATRI RESTRO',
      stationCode: 'CNB',
    })
  })

  it('keeps a waitlist-status prefix ("RAC/A2 / 17") as part of coach, split from berth', () => {
    const r = parser.parse(fx.SAMPLE_RAC_SEAT, RECEIVED)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.order).toMatchObject({
      externalOrderId: '1000591314',
      outletName: 'YATRI RESTRO',
      coach: 'RAC/A2',
      berth: '17',
      rawSeat: 'RAC/A2-17',
    })
  })

  it('refuses to build a partial order when items are missing', () => {
    const r = parser.parse(fx.MALFORMED_NO_ITEMS, RECEIVED)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('MISSING_FIELD')
    expect(r.detail).toMatch(/items/i)
    expect(r.partial?.externalOrderId).toBe('1000085222')
  })

  it('rejects an unrelated email outright', () => {
    expect(parser.matches(fx.GARBAGE)).toBe(false)
    const r = parser.parse(fx.GARBAGE, RECEIVED)
    expect(r.ok).toBe(false)
  })

  it('recognises its own emails', () => {
    expect(parser.matches(fx.SAMPLE)).toBe(true)
    expect(parser.matches(fx.MULTI_ITEM)).toBe(true)
  })

  it('parses a real Gmail-forwarded copy, wrapper and footer domain included', () => {
    expect(parser.matches(fx.SAMPLE_FORWARDED)).toBe(true)
    const r = parser.parse(fx.SAMPLE_FORWARDED, RECEIVED)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.order).toMatchObject({
      externalOrderId: '1000373994',
      outletName: 'The fast food king',
      stationName: 'GAYA JN',
      stationCode: 'GAYA',
      contactName: 'ayush kumar',
      contactPhone: '6205228491',
      trainNo: '13350',
      trainName: 'PNBE SGRL EXP',
      coach: 'B1',
      berth: '19',
      amountPaise: 33900,
      paymentMode: 'COD',
    })
    expect(r.order.items).toEqual([{
      name: 'Veg deluxe Thali',
      qty: 1,
      notes: 'Paneer butter masala,Mix veg,Dal fry/Dal tadka,Jeera Rice,Butter Roti(3pcs),Salad,Pickle,Sweet,Cutlery',
    }])
  })

  it('parses the vendor\'s real one-cell-per-line HTML (no delimiter between cells at all)', () => {
    expect(parser.matches(fx.SAMPLE_ONE_TOKEN_PER_LINE)).toBe(true)
    const r = parser.parse(fx.SAMPLE_ONE_TOKEN_PER_LINE, RECEIVED)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.order).toMatchObject({
      externalOrderId: '1000591416',
      outletName: 'YATRI RESTRO',
      stationCode: 'CNB',
      stationName: 'KANPUR CENTRAL',
      contactName: 'Akash',
      contactPhone: '9939978198',
      trainNo: '12488',
      trainName: 'SEEMANCHAL EXP',
      coach: 'A2',
      berth: '19',
      amountPaise: 70900,
      paymentMode: 'COD',
    })
    expect(r.order.items).toEqual([{
      name: 'Veg Maharaja Thali',
      qty: 3,
      notes: 'Paneer veg dish Seasonal veg dal tadka Jeera rice Butter tava roti 3pcs Salad Pickle Gulab jamun Spoon Paper napkin',
    }])
    // 01-09-2026 14:10 IST = 08:40 UTC.
    expect(r.order.scheduledArrival?.toISOString()).toBe('2026-09-01T08:40:00.000Z')
  })

  it('parses a Gmail "Fwd:" that reflowed everything into single-space run-on text', () => {
    expect(parser.matches(fx.SAMPLE_GMAIL_FWD_COLLAPSED)).toBe(true)
    const r = parser.parse(fx.SAMPLE_GMAIL_FWD_COLLAPSED, RECEIVED)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.order).toMatchObject({
      externalOrderId: '1000373994',
      outletName: 'The fast food king',
      stationCode: 'GAYA',
      stationName: 'GAYA JN',
      contactName: 'ayush kumar',
      contactPhone: '6205228491',
      trainNo: '13350',
      trainName: 'PNBE SGRL EXP',
      coach: 'B1',
      berth: '19',
      amountPaise: 33900,
      paymentMode: 'COD',
    })
    // No delimiter survives the reflow, so the combined name+description text
    // is kept as name rather than guessing where to cut it.
    expect(r.order.items).toEqual([{
      name: 'Veg deluxe Thali Paneer butter masala,Mix veg,Dal fry/Dal tadka,Jeera Rice,Butter Roti(3pcs),Salad,Pickle,Sweet,Cutlery',
      qty: 1,
      notes: null,
    }])
  })

  it('is deterministic', () => {
    const a = parser.parse(fx.SAMPLE, RECEIVED)
    const b = parser.parse(fx.SAMPLE, RECEIVED)
    expect(a).toEqual(b)
  })
})
