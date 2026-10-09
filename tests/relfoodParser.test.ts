import { describe, expect, it } from 'vitest'
import { PARSERS } from '../src/lib/ingest'
import { PAYMENT_PARSERS } from '../src/lib/ingest/payments'
import { RelFoodParser, RelFoodWhatsAppParser } from '../src/lib/ingest/parsers/relfood'
import * as fx from './fixtures/relfood'
import * as brotherbyteFx from './fixtures/brotherbyte'
import * as homebytesFx from './fixtures/homebytes'
import * as railrestroFx from './fixtures/railrestro'
import * as rajbhogFx from './fixtures/rajbhog'
import * as sliceFx from './fixtures/slice'
import * as yatriRestroFx from './fixtures/yatriRestro'
import * as yatriRestroBookingFx from './fixtures/yatriRestroBooking'
import * as yatribhojanFx from './fixtures/yatribhojan'
import * as zoopFx from './fixtures/zoop'

const mail = new RelFoodParser()
const whatsapp = new RelFoodWhatsAppParser()
const RECEIVED = new Date('2026-10-09T05:00:00Z')

const ORDER = {
  source: 'RELFOOD',
  externalOrderId: '1192186',
  outletName: 'THE COSMOZIN LOUNGE',
  stationName: 'KANPUR CENTRAL',
  stationCode: 'CNB',
  contactName: 'Samim Abedin',
  contactPhone: '9563871687',
  trainNo: '15483',
  trainName: 'SIKKIMMAHANANDA',
  coach: 'A1',
  berth: '26',
  rawSeat: 'A1-26',
  amountPaise: 25100,
  paymentMode: 'PREPAID',
}

// 9 Oct 2026, 12:50 IST — written month-first in the mail and day-first on WhatsApp.
const ARRIVAL = '2026-10-09T07:20:00.000Z'

describe('RelFood mail parser', () => {
  it('parses a real sample order, pasted', () => {
    const r = mail.parse(fx.MAIL_SAMPLE, RECEIVED)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.order).toMatchObject(ORDER)
    expect(r.order.items).toEqual([
      {
        name: 'Special Egg Thali',
        qty: 1,
        notes: 'Egg Curry (2pcs), Daal Fry, Jeera Rice, Tava Roti (3pcs), Salad, Pickle, Gulab Jamun, Spoon, Paper Napkin',
      },
    ])
    expect(r.order.scheduledArrival?.toISOString()).toBe(ARRIVAL)
  })

  // What the Gmail sync hands over: tabs for table gaps, the first summary
  // row on the same line as its heading, and money still to collect.
  it('parses a real sample order as the Gmail sync delivers it', () => {
    // Mail Date header: 8 Oct 2026 07:29:40 +0530.
    const r = mail.parse(fx.MAIL_SAMPLE_GMAIL, new Date('2026-10-08T01:59:40Z'))
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.order).toMatchObject({
      source: 'RELFOOD',
      externalOrderId: '1190676',
      outletName: 'THE COSMOZIN LOUNGE',
      stationName: 'KANPUR CENTRAL',
      stationCode: 'CNB',
      contactName: 'Sunil Sharma',
      contactPhone: '6393369360',
      trainNo: '12512',
      trainName: 'RAPTISAGAR SF EX',
      coach: 'B7',
      berth: '65',
      rawSeat: 'B7-65',
      // "Total 158", not the "Sub Total 150" three rows above it.
      amountPaise: 15800,
      paymentMode: 'COD',
    })
    expect(r.order.items).toEqual([
      {
        name: 'Veg Mini Thali',
        qty: 1,
        notes: 'Seasonal Veg, Daal Fry, Jeera Rice, Tava Roti (2pcs), Salad, Pickle, Gulab Jamun, Spoon, Tissue Paper',
      },
    ])
    // "10/8/2026 & 07:55" is 8 Oct 07:55 IST — 26 minutes after the mail was
    // sent. Read day-first it would be 10 Aug, two months before the booking.
    expect(r.order.scheduledArrival?.toISOString()).toBe('2026-10-08T02:25:00.000Z')
  })

  it('rejects an unrelated email', () => {
    expect(mail.matches('some unrelated email')).toBe(false)
  })

  it('is the parser PARSERS dispatches both real samples to', () => {
    for (const body of [fx.MAIL_SAMPLE, fx.MAIL_SAMPLE_GMAIL]) {
      expect(PARSERS.find((x) => x.matches(body))).toBeInstanceOf(RelFoodParser)
    }
  })
})

describe('RelFood WhatsApp parser', () => {
  it('parses a real sample message', () => {
    const r = whatsapp.parse(fx.WHATSAPP_SAMPLE, RECEIVED)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.order).toMatchObject(ORDER)
    // The trailing ".." is not part of the dish, and "NA" is not a remark.
    expect(r.order.items).toEqual([{ name: 'Special Egg Thali', qty: 1, notes: null }])
    expect(r.order.scheduledArrival?.toISOString()).toBe(ARRIVAL)
  })

  it('parses a message copied with its bold markers', () => {
    const bold = fx.WHATSAPP_SAMPLE.replace(/^(.+:)$/gm, '*$1*').replace(/^([^:\n]+:) /gm, '*$1* ')
    expect(whatsapp.matches(bold)).toBe(true)
    const r = whatsapp.parse(bold, RECEIVED)
    expect(r.ok && r.order).toMatchObject(ORDER)
  })

  it('passes a real remark to the kitchen on the item', () => {
    const r = whatsapp.parse(
      fx.WHATSAPP_SAMPLE.replace('Additional Remarks: NA', 'Additional Remarks: Less spicy'),
      RECEIVED,
    )
    expect(r.ok && r.order.items).toEqual([{ name: 'Special Egg Thali', qty: 1, notes: 'Less spicy' }])
  })

  it('rejects an unrelated message', () => {
    expect(whatsapp.matches('some unrelated message')).toBe(false)
  })

  it('is the parser PARSERS dispatches a real sample to', () => {
    const p = PARSERS.find((x) => x.matches(fx.WHATSAPP_SAMPLE))
    expect(p).toBeInstanceOf(RelFoodWhatsAppParser)
  })
})

describe('RelFood customer with two phone numbers', () => {
  // Real orders 1192282 and 1192332: the customer left two numbers, and the
  // order used to come out with no phone at all.
  const twoNumbers = (body: string, from: string) => body.replace(from, '8584033906, 9748539608')

  it('keeps the first number from the mail', () => {
    const body = twoNumbers(fx.MAIL_SAMPLE_GMAIL, '6393369360')
    expect(body).toContain('8584033906, 9748539608')
    const r = mail.parse(body, RECEIVED)
    expect(r.ok && r.order.contactPhone).toBe('8584033906')
  })

  it('keeps the first number from the WhatsApp message', () => {
    const body = twoNumbers(fx.WHATSAPP_SAMPLE, '9563871687')
    const r = whatsapp.parse(body, RECEIVED)
    expect(r.ok && r.order.contactPhone).toBe('8584033906')
  })

  it('still reads a number written with +91 and spaces', () => {
    const r = whatsapp.parse(fx.WHATSAPP_SAMPLE.replace('9563871687', '+91 95638 71687'), RECEIVED)
    expect(r.ok && r.order.contactPhone).toBe('9563871687')
  })

  it('leaves the phone empty when nothing in the field is a number', () => {
    const r = whatsapp.parse(fx.WHATSAPP_SAMPLE.replace('9563871687', 'NA'), RECEIVED)
    expect(r.ok && r.order.contactPhone).toBeNull()
  })
})

describe('RelFood across both layouts', () => {
  // The mail is ingested by itself and the WhatsApp message is pasted by a
  // person, so the same order routinely arrives twice. The unique index on
  // externalOrderId is what makes the second one a no-op, and it can only do
  // that if both layouts produce the same id.
  it('gives one order the same id and delivery time either way', () => {
    const a = mail.parse(fx.MAIL_SAMPLE, RECEIVED)
    const b = whatsapp.parse(fx.WHATSAPP_SAMPLE, RECEIVED)
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return

    expect(a.order.externalOrderId).toBe(b.order.externalOrderId)
    expect(a.order.scheduledArrival?.getTime()).toBe(b.order.scheduledArrival?.getTime())
  })

  // The WhatsApp parser matches on shape alone, which is the kind of matcher
  // that ends up claiming somebody else's mail.
  it('claims no other aggregator\'s sample', () => {
    const others = [
      brotherbyteFx, homebytesFx, railrestroFx, rajbhogFx, sliceFx,
      yatriRestroFx, yatriRestroBookingFx, yatribhojanFx, zoopFx,
    ].flatMap((m) => Object.values<unknown>(m).filter((v): v is string => typeof v === 'string'))
    expect(others.length).toBeGreaterThan(9)

    for (const body of others) {
      expect(mail.matches(body)).toBe(false)
      expect(whatsapp.matches(body)).toBe(false)
    }
  })

  it('is not mistaken for a bank credit alert, which is tried first', () => {
    for (const body of [fx.MAIL_SAMPLE, fx.MAIL_SAMPLE_GMAIL, fx.WHATSAPP_SAMPLE]) {
      expect(PAYMENT_PARSERS.some((p) => p.matches(body))).toBe(false)
    }
  })
})
