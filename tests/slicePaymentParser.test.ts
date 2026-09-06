import { describe, expect, it } from 'vitest'
import { PARSERS } from '../src/lib/ingest'
import { PAYMENT_PARSERS } from '../src/lib/ingest/payments'
import { SlicePaymentParser } from '../src/lib/ingest/payments/slice'
import * as fx from './fixtures/slice'

const parser = new SlicePaymentParser()
const RECEIVED = new Date('2026-09-06T13:38:00Z') // 6 Sep 2026, 7:08 pm IST

describe('slice payment parser', () => {
  it('parses a real credit alert', () => {
    const r = parser.parse(fx.SAMPLE, RECEIVED)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.payment).toEqual({
      provider: 'SLICE',
      payerName: 'AMITKUMAR TIWARI',
      amountPaise: 23000,
      rrn: '661533935455',
      method: 'UPI',
      accountLast4: '8773',
      transactionDate: '2026-09-06',
      availableBalancePaise: 357123,
    })
  })

  it('reads space-separated labels and a thousands separator', () => {
    const r = parser.parse(fx.SAMPLE_SPACED, RECEIVED)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.payment.payerName).toBe('S RAJESH KUMAR')
    expect(r.payment.amountPaise).toBe(124050)
    expect(r.payment.availableBalancePaise).toBe(1200473)
    // A two-digit year takes its century from the email, not from the decade
    // this code was written in.
    expect(r.payment.transactionDate).toBe('2025-12-31')
  })

  it('takes the payer from the alert, not from a forwarded From: header', () => {
    const r = parser.parse(fx.SAMPLE_FORWARDED, RECEIVED)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payment.payerName).toBe('AMITKUMAR TIWARI')
  })

  it('records the payment even when the alert quotes no balance', () => {
    const r = parser.parse(fx.SAMPLE_NO_BALANCE, RECEIVED)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // Unknown, not zero — a ₹0 balance would be a lie the summary card reads.
    expect(r.payment.availableBalancePaise).toBeNull()
    expect(r.payment.amountPaise).toBe(50000)
  })

  it('refuses an alert with no RRN rather than inventing an identity for it', () => {
    const r = parser.parse(fx.SAMPLE_NO_RRN, RECEIVED)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('MISSING_FIELD')
    expect(r.detail).toMatch(/RRN/i)
  })

  it('does not match a debit alert', () => {
    expect(parser.matches(fx.SAMPLE_DEBIT)).toBe(false)
  })

  it('does not match an unrelated email', () => {
    expect(parser.matches('some unrelated email')).toBe(false)
  })

  it('is the parser PAYMENT_PARSERS dispatches a real alert to', () => {
    expect(PAYMENT_PARSERS.find((p) => p.matches(fx.SAMPLE))).toBeInstanceOf(SlicePaymentParser)
  })

  it('is not mistaken for an order by any order parser', () => {
    // The whole point of the change: a credit alert must never reach the
    // order parsers, and none of them may claim it if it somehow does.
    expect(PARSERS.find((p) => p.matches(fx.SAMPLE))).toBeUndefined()
  })
})
