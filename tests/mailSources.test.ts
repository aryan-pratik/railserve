import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { disconnectDb } from '../src/lib/db'
import { MailSource, Order, Payment, UnparsedInbox } from '../src/lib/models'
import { ingestEmail } from '../src/lib/ingest'
import { gmailAuthHeader, readMailAuth } from '../src/lib/ingest/mailAuth'
import { learnField, learnItems, normaliseBody, validateRules } from '../src/lib/ingest/templates/engine'
import type { TemplateField } from '../src/lib/ingest/templates/types'
import { ctxFor, makeRestaurant, makeUser, resetDb, tenantId } from './fixtures'
import { reingestInboxRows } from '../src/lib/repo/inboxRepo'
import * as yr from './fixtures/yatriRestro'
import * as slice from './fixtures/slice'

/*
 * Part 1 of order-email security: with "only known senders" on, an email
 * becomes an order only when its layout AND its sender match. Off, nothing
 * changes from before.
 */

const RECEIVED = new Date('2026-08-27T08:00:00Z')
const GMAIL_PASS = 'mx.google.com; dkim=pass header.i=@yatrirestro.example header.s=s1 header.b=abc; spf=pass smtp.mailfrom=yatrirestro.example; dmarc=pass (p=NONE) header.from=yatrirestro.example'

const mail = (body: string, from: string, opts: { enforce?: boolean; auth?: string | null; id?: string } = {}) => ({
  tenantId: tenantId(),
  body,
  receivedAt: RECEIVED,
  gmailMessageId: opts.id ?? `g-${Math.random().toString(36).slice(2)}`,
  subject: 'Order',
  from,
  mailbox: { enforceSenders: opts.enforce ?? false, authResults: opts.auth ?? null },
})

const listSender = (key: string, kind: 'BUILTIN' | 'PAYMENT', senders: string[], requireVerified = false) =>
  MailSource.create({ tenantId: tenantId(), key, kind, name: key, source: (kind === 'BUILTIN' ? key : null) as never, senders, requireVerified })

describe('order emails: sender checks', () => {
  beforeEach(async () => {
    await resetDb()
    await makeRestaurant('HOTEL GANGA GALAXY', 'CNB', ['GANGA GALAXY'])
  })
  afterAll(async () => {
    await disconnectDb()
  })

  it('with checking off, behaves exactly as before: any sender can create an order', async () => {
    const r = await ingestEmail(mail(yr.SAMPLE_WITH_EMOJI, 'someone@random.example'))
    expect(r.status).toBe('CREATED')
  })

  it('with checking on, holds back a lookalike from an unlisted sender instead of creating an order', async () => {
    await listSender('YATRIRESTRO', 'BUILTIN', ['orders@yatrirestro.example'])
    const r = await ingestEmail(mail(yr.SAMPLE_WITH_EMOJI, 'Fake <spam@evil.example>', { enforce: true }))
    expect(r.status).toBe('UNPARSED')
    expect(await Order.countDocuments({ tenantId: tenantId() })).toBe(0)
    const row = await UnparsedInbox.findOne({ tenantId: tenantId() }).lean()
    expect(row?.reason).toBe('SENDER_NOT_TRUSTED')
    expect(row?.source).toBe('YATRIRESTRO')
    expect(row?.detail).toMatch(/spam@evil\.example/)
    // What the order would have been is kept, so the admin can judge it.
    expect((row?.partial as { externalOrderId?: string })?.externalOrderId).toBe('1000584805')
  })

  it('with checking on, creates the order when the sender is listed for that aggregator', async () => {
    await listSender('YATRIRESTRO', 'BUILTIN', ['@yatrirestro.example'])
    const r = await ingestEmail(mail(yr.SAMPLE_WITH_EMOJI, 'YatriRestro <orders@yatrirestro.example>', { enforce: true }))
    expect(r.status).toBe('CREATED')
  })

  it('a sender listed for one aggregator cannot send another aggregator’s layout', async () => {
    await listSender('ZOOP', 'BUILTIN', ['orders@yatrirestro.example'])
    const r = await ingestEmail(mail(yr.SAMPLE_WITH_EMOJI, 'orders@yatrirestro.example', { enforce: true }))
    expect(r.status).toBe('UNPARSED')
  })

  it('skips mail that is no order from a stranger, without a row', async () => {
    const r = await ingestEmail(mail('Weekly newsletter. Nothing to see.', 'news@shop.example', { enforce: true }))
    expect(r.status).toBe('IGNORED')
    expect(await UnparsedInbox.countDocuments({ tenantId: tenantId() })).toBe(0)
  })

  it('when a source asks for it, accepts only mail Gmail confirms is genuine', async () => {
    await listSender('YATRIRESTRO', 'BUILTIN', ['orders@yatrirestro.example'], true)
    const forged = await ingestEmail(mail(yr.SAMPLE_WITH_EMOJI, 'orders@yatrirestro.example', { enforce: true, auth: null }))
    expect(forged.status).toBe('UNPARSED')
    const genuine = await ingestEmail(mail(yr.SAMPLE_NO_EMOJI, 'orders@yatrirestro.example', { enforce: true, auth: GMAIL_PASS }))
    expect(genuine.status).toBe('CREATED')
    const order = await Order.findOne({ tenantId: tenantId() }).lean()
    expect((order?.rawPayload as { auth?: { verified: boolean } }).auth?.verified).toBe(true)
  })

  it('needs a bank alert’s sender listed too, once checking is on', async () => {
    const held = await ingestEmail(mail(slice.SAMPLE, 'alerts@bank.example', { enforce: true }))
    expect(held.status).toBe('UNPARSED')
    expect(await Payment.countDocuments({ tenantId: tenantId() })).toBe(0)
    await listSender('PAY:SLICE', 'PAYMENT', ['alerts@bank.example'])
    const ok = await ingestEmail(mail(slice.SAMPLE, 'alerts@bank.example', { enforce: true }))
    expect(ok.status).toBe('PAYMENT')
  })
})

describe('order emails: held mail is never re-read in bulk', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('bulk re-ingest skips an email held for an unknown sender, and still fixes the rest', async () => {
    await listSender('YATRIRESTRO', 'BUILTIN', ['orders@yatrirestro.example'])
    const held = await ingestEmail(mail(yr.SAMPLE_WITH_EMOJI, 'spam@evil.example', { enforce: true }))
    const outlet = await ingestEmail(mail(yr.SAMPLE_NO_EMOJI, 'orders@yatrirestro.example', { enforce: true }))
    expect(held.status).toBe('UNPARSED')
    expect(outlet.status).toBe('UNPARSED') // no outlet yet
    await makeRestaurant('HOTEL GANGA GALAXY', 'CNB', ['GANGA GALAXY'])

    const admin = ctxFor(await makeUser('ADMIN', '9400000099'))
    const ids = [held, outlet].map((r) => (r as { inboxId: string }).inboxId)
    const r = await reingestInboxRows(admin, { ids })
    expect(r.resolved).toBe(1)
    expect(r.errors.join(' ')).toMatch(/unknown senders skipped/)
    expect((await UnparsedInbox.findOne({ _id: ids[0], tenantId: tenantId() }).lean())?.resolved).toBe(false)
    expect(await Order.countDocuments({ tenantId: tenantId() })).toBe(1)
  })
})

describe('order emails: Gmail authenticity', () => {
  it('reads only the header Gmail itself added', () => {
    const headers = [
      { name: 'Authentication-Results', value: 'mx.google.com; dkim=fail header.i=@zoop.in; dmarc=fail header.from=zoop.in' },
      // A copy the sender wrote into its own mail: ignored.
      { name: 'Authentication-Results', value: 'evil.example; dkim=pass header.i=@zoop.in; dmarc=pass' },
    ]
    expect(readMailAuth(gmailAuthHeader(headers), 'orders@zoop.in')?.verified).toBe(false)
  })

  it('counts a passing signature from the sender’s own domain as genuine', () => {
    const h = 'mx.google.com; dkim=pass header.i=@mail.zoop.in; spf=softfail; dmarc=none'
    expect(readMailAuth(h, 'orders@zoop.in')?.verified).toBe(true)
    expect(readMailAuth(h, 'orders@other.in')?.verified).toBe(false)
  })
})

describe('order emails: a taught layout', () => {
  const BODY = [
    'TrainBites order confirmation',
    'Booking ref: TB-778812',
    'Guest: Meena Gupta',
    'Mobile: 9876501234',
    'Train: 12554 Vaishali Exp',
    'Seat: B2/41',
    'Station: CNB',
    'Kitchen: HOTEL GANGA GALAXY',
    'Delivery: 27-Aug-2026 14:30',
    'Food ordered',
    'Veg Thali x 2',
    'Masala Chai x 3',
    'Bill amount: Rs 460',
  ].join('\n')

  function teach() {
    const t = normaliseBody(BODY)
    const at = (s: string) => ({ start: t.indexOf(s), end: t.indexOf(s) + s.length })
    const marks: [TemplateField, string][] = [
      ['externalOrderId', 'TB-778812'], ['contactName', 'Meena Gupta'], ['contactPhone', '9876501234'], ['trainNo', '12554 Vaishali Exp'],
      ['seat', 'B2/41'], ['stationCode', 'CNB'], ['outletName', 'HOTEL GANGA GALAXY'], ['arrival', '27-Aug-2026 14:30'], ['amount', 'Rs 460'],
    ]
    const fields = marks.map(([f, v]) => {
      const r = learnField(t, f, at(v))
      if ('error' in r) throw new Error(r.error)
      return r
    })
    const items = learnItems(t, at('Veg Thali'), { start: t.indexOf('2', t.indexOf('Veg Thali')), end: t.indexOf('2', t.indexOf('Veg Thali')) + 1 })
    if ('error' in items) throw new Error(items.error)
    return validateRules({ fields, items, fixed: {}, dateOrder: 'DMY' })
  }

  beforeEach(async () => {
    await resetDb()
    await makeRestaurant('HOTEL GANGA GALAXY', 'CNB')
    await MailSource.create({ tenantId: tenantId(), key: 'T:test', kind: 'TAUGHT', name: 'TrainBites', source: 'OTHER', senders: ['orders@trainbites.example'], rules: teach() })
  })

  it('turns mail from its sender into an order with every marked field', async () => {
    const r = await ingestEmail(mail(BODY, 'TrainBites <orders@trainbites.example>'))
    expect(r.status).toBe('CREATED')
    const o = await Order.findOne({ tenantId: tenantId(), externalOrderId: 'TB-778812' }).lean()
    expect(o).toMatchObject({ source: 'OTHER', contactName: 'Meena Gupta', contactPhone: '9876501234', trainNo: '12554', coach: 'B2', berth: '41', stationCode: 'CNB', amountPaise: 46000 })
    expect(o!.items.filter((i) => !i.isPacking).map((i) => [i.name, i.qty])).toEqual([['Veg Thali', 2], ['Masala Chai', 3]])
  })

  it('never reads the same layout from anyone else', async () => {
    const r = await ingestEmail(mail(BODY, 'copycat@evil.example'))
    expect(r.status).not.toBe('CREATED')
    expect(await Order.countDocuments({ tenantId: tenantId() })).toBe(0)
  })
})
