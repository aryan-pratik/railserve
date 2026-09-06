import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { disconnectDb } from '../src/lib/db'
import { Payment, UnparsedInbox } from '../src/lib/models'
import { ingestEmail } from '../src/lib/ingest'
import { findPayments, latestBalance, paymentTotals, setPaymentRemark } from '../src/lib/repo/paymentRepo'
import { ForbiddenError, type AuthContext } from '../src/lib/authContext'
import mongoose from 'mongoose'
import { resetDb } from './fixtures'
import * as fx from './fixtures/slice'

const RECEIVED = new Date('2026-09-06T13:38:00Z')

const alert = (body: string, gmailMessageId?: string) => ({
  body,
  receivedAt: RECEIVED,
  gmailMessageId,
  subject: 'Money received',
  from: 'no-reply@slice.bank.in',
})

const ctx = (role: AuthContext['role']): AuthContext => ({
  userId: new mongoose.Types.ObjectId(),
  role,
  restaurantIds: [],
})

describe('payment ingestion', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await disconnectDb()
  })

  it('turns a credit alert into a payment and never into an inbox row', async () => {
    const r = await ingestEmail(alert(fx.SAMPLE, 'gmail-pay-1'))
    expect(r.status).toBe('PAYMENT')

    const payment = await Payment.findOne({ rrn: '661533935455' }).lean()
    expect(payment).not.toBeNull()
    expect(payment!.payerName).toBe('AMITKUMAR TIWARI')
    expect(payment!.amountPaise).toBe(23000)
    expect(payment!.transactionDate).toBe('2026-09-06')
    expect(payment!.availableBalancePaise).toBe(357123)
    expect(payment!.gmailMessageId).toBe('gmail-pay-1')
    // The raw alert is kept, exactly as an order keeps its email.
    expect((payment!.rawPayload as { body: string }).body).toContain('slice')

    // The whole point: this must not be sitting in "needs attention".
    expect(await UnparsedInbox.countDocuments({})).toBe(0)
  })

  it('treats a replayed alert as an idempotent no-op', async () => {
    await ingestEmail(alert(fx.SAMPLE, 'gmail-pay-1'))
    const second = await ingestEmail(alert(fx.SAMPLE, 'gmail-pay-1'))

    expect(second.status).toBe('PAYMENT_DUPLICATE')
    expect(await Payment.countDocuments({})).toBe(1)
  })

  it('dedupes on the RRN even with no unique index to enforce it', async () => {
    // The state this actually guards: connectDb sets autoIndex: false, so a
    // database where `npm run indexes` was never run has no unique index at
    // all — and a replayed credit alert would silently double the day's
    // takings. The upsert has to carry idempotence on its own.
    await Payment.collection.dropIndex('rrn_unique')

    await ingestEmail(alert(fx.SAMPLE, 'gmail-pay-1'))
    const second = await ingestEmail(alert(fx.SAMPLE, 'gmail-pay-1'))

    expect(second.status).toBe('PAYMENT_DUPLICATE')
    expect(await Payment.countDocuments({})).toBe(1)
  })

  it('never lets a replay overwrite a remark written since', async () => {
    const first = await ingestEmail(alert(fx.SAMPLE, 'gmail-pay-1'))
    if (first.status !== 'PAYMENT') throw new Error('expected a payment')

    await setPaymentRemark(ctx('STORE_MANAGER'), first.paymentId, 'order 1000584805')
    await ingestEmail(alert(fx.SAMPLE, 'gmail-pay-1'))

    expect((await Payment.findById(first.paymentId).lean())!.remark).toBe('order 1000584805')
  })

  it('dedupes on the RRN even when the same alert is pasted by hand', async () => {
    await ingestEmail(alert(fx.SAMPLE, 'gmail-pay-1'))
    // No gmailMessageId at all — the paste path. The RRN is what stops it.
    const pasted = await ingestEmail({ body: fx.SAMPLE, receivedAt: RECEIVED })

    expect(pasted.status).toBe('PAYMENT_DUPLICATE')
    expect(await Payment.countDocuments({})).toBe(1)
  })

  it('files an unreadable credit alert in the inbox, where a template change belongs', async () => {
    const r = await ingestEmail(alert(fx.SAMPLE_NO_RRN, 'gmail-pay-broken'))

    expect(r.status).toBe('UNPARSED')
    expect(await Payment.countDocuments({})).toBe(0)
    const row = await UnparsedInbox.findOne({ resolved: false }).lean()
    expect(row!.source).toBe('SLICE')
    expect(row!.reason).toBe('MISSING_FIELD')
  })

  it('leaves a debit alert to the normal path rather than recording it as money in', async () => {
    const r = await ingestEmail(alert(fx.SAMPLE_DEBIT, 'gmail-debit'))

    expect(r.status).toBe('UNPARSED')
    expect(await Payment.countDocuments({})).toBe(0)
  })
})

describe('payment repository', () => {
  beforeEach(async () => {
    await resetDb()
    await ingestEmail(alert(fx.SAMPLE, 'gmail-pay-1'))
    await ingestEmail(alert(fx.SAMPLE_SPACED, 'gmail-pay-2'))
    await ingestEmail(alert(fx.SAMPLE_NO_BALANCE, 'gmail-pay-3'))
  })

  afterAll(async () => {
    await disconnectDb()
  })

  it('filters by transaction-date range', async () => {
    const all = await findPayments({})
    expect(all).toHaveLength(3)

    // SAMPLE_SPACED is dated 31-Dec-25; the other two are 6 Sep 2026.
    const sept = await findPayments({ from: '2026-09-01', to: '2026-09-30' })
    expect(sept.map((p) => p.rrn).sort()).toEqual(['661533935455', '661599112233'])
  })

  it('searches by payer name, RRN and remark', async () => {
    expect(await findPayments({ q: 'rajesh' })).toHaveLength(1)
    expect(await findPayments({ q: '661533935455' })).toHaveLength(1)
    // A parenthesis in the query must match nothing, not throw.
    expect(await findPayments({ q: 'kumar(' })).toHaveLength(0)
  })

  it('totals only what the filter selected', async () => {
    const all = await paymentTotals({})
    expect(all).toEqual({ count: 3, totalPaise: 23000 + 124050 + 50000 })

    const sept = await paymentTotals({ from: '2026-09-01', to: '2026-09-30' })
    expect(sept).toEqual({ count: 2, totalPaise: 23000 + 50000 })
  })

  it('reports the newest quoted balance to an admin', async () => {
    const reading = await latestBalance(ctx('ADMIN'))
    // SAMPLE_NO_BALANCE is the newest row but quotes none, so the balance
    // comes from the newest alert that actually carried one.
    expect(reading?.balancePaise).toBe(357123)
  })

  it('refuses the balance to a store manager', async () => {
    await expect(latestBalance(ctx('STORE_MANAGER'))).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('lets both an admin and a store manager write a remark', async () => {
    const [payment] = await findPayments({ q: '661533935455' })

    await setPaymentRemark(ctx('STORE_MANAGER'), String(payment._id), 'order 1000584805')
    expect((await Payment.findById(payment._id).lean())!.remark).toBe('order 1000584805')

    await setPaymentRemark(ctx('ADMIN'), String(payment._id), null)
    expect((await Payment.findById(payment._id).lean())!.remark).toBeNull()
  })

  it('refuses a remark from a delivery agent', async () => {
    const [payment] = await findPayments({ q: '661533935455' })
    await expect(
      setPaymentRemark(ctx('DELIVERY_AGENT'), String(payment._id), 'nope'),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})
