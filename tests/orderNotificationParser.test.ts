import { describe, expect, it } from 'vitest'
import { PARSERS } from '../src/lib/ingest'
import { OrderNotificationParser } from '../src/lib/ingest/parsers/orderNotification'
import * as fx from './fixtures/orderNotification'

const parser = new OrderNotificationParser()
const RECEIVED = new Date('2026-11-13T04:58:00Z')

const EXPECTED = {
  source: 'NOTIFICATION',
  externalOrderId: '2504099482',
  outletName: 'Order Notification',
  stationName: 'KANPUR CENTRAL',
  stationCode: 'CNB',
  contactName: 'Jitu Singh',
  contactPhone: '9718847329',
  trainNo: '05094',
  trainName: 'HDP GKP SPECIAL',
  coach: 'A2',
  berth: '39',
  rawSeat: 'A2-39',
  amountPaise: 19700,
  paymentMode: 'PREPAID',
  items: [{ name: 'PANEER CURRY WITH ROTI COMBO (Veg)', qty: 1, notes: 'Provide Good Food' }],
}

describe('New Order Notification parser', () => {
  it.each([
    ['as sent', fx.SAMPLE],
    ['with "&amp;" still escaped', fx.SAMPLE_ESCAPED],
    ['Gmail-flattened', fx.SAMPLE_GMAIL],
  ])('parses the sample %s', (_label, body) => {
    expect(parser.matches(body)).toBe(true)
    const r = parser.parse(body, RECEIVED)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.order).toMatchObject(EXPECTED)
    // 13-11-2026 15:21 IST
    expect(r.order.scheduledArrival?.toISOString()).toBe('2026-11-13T09:51:00.000Z')
  })

  it('reads a cash order with several items and no note', () => {
    const r = parser.parse(fx.SAMPLE_COD, RECEIVED)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.order).toMatchObject({
      externalOrderId: '2504100001',
      stationCode: 'PRYJ',
      contactPhone: '9876543210',
      amountPaise: 54000,
      paymentMode: 'COD',
      coach: 'B3',
      berth: '12',
    })
    expect(r.order.items).toEqual([
      { name: 'VEG THALI (Veg)', qty: 2, notes: null },
      { name: 'EGG BIRYANI (Non-Veg)', qty: 1, notes: null },
      { name: 'WATER BOTTLE', qty: 3, notes: null },
    ])
    expect(r.order.scheduledArrival?.toISOString()).toBe('2026-12-01T00:35:00.000Z')
  })

  it('falls back to Payment Type when there is no amount to collect', () => {
    const body = fx.SAMPLE_COD.replace(/^Amount to Collect.*$/m, '')
    const r = parser.parse(body, RECEIVED)
    expect(r.ok && r.order.paymentMode).toBe('COD')
  })

  it('fails closed on a station with no known code', () => {
    const r = parser.parse(fx.SAMPLE.replace('KANPUR CENTRAL', 'NOWHERE JN'), RECEIVED)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('MISSING_FIELD')
      expect(r.partial?.externalOrderId).toBe('2504099482')
    }
  })

  it('rejects an unrelated email', () => {
    expect(parser.matches('some unrelated email')).toBe(false)
  })

  it.each([
    ['as sent', fx.SAMPLE],
    ['escaped', fx.SAMPLE_ESCAPED],
    ['Gmail-flattened', fx.SAMPLE_GMAIL],
  ])('is the parser PARSERS dispatches the %s sample to', (_label, body) => {
    expect(PARSERS.find((x) => x.matches(body))).toBeInstanceOf(OrderNotificationParser)
  })
})
