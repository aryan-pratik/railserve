import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { disconnectDb } from '../src/lib/db'
import { Order, UnparsedInbox } from '../src/lib/models'
import { ingestEmail } from '../src/lib/ingest'
import { matchOutlet } from '../src/lib/ingest/outletMatch'
import { makeRestaurant, resetDb } from './fixtures'
import * as fx from './fixtures/yatriRestro'
import * as bookingFx from './fixtures/yatriRestroBooking'

const RECEIVED = new Date('2026-08-27T08:00:00Z')

const email = (body: string, gmailMessageId?: string) => ({
  body,
  receivedAt: RECEIVED,
  gmailMessageId,
  subject: 'New order',
  from: 'orders@yatrirestro.example',
})

describe('retail ingestion', () => {
  beforeEach(async () => {
    await resetDb()
    await makeRestaurant('HOTEL GANGA GALAXY', 'CNB', ['GANGA GALAXY'])
    await makeRestaurant('SHREE ANNAPURNA BHOJNALAYA', 'PRYJ', ['SHREE ANNAPURNA'])
  })

  afterAll(async () => {
    await disconnectDb()
  })

  it('turns a real order email into an order on the right outlet', async () => {
    const r = await ingestEmail(email(fx.SAMPLE_WITH_EMOJI, 'gmail-1'))
    expect(r.status).toBe('CREATED')

    const order = await Order.findOne({ externalOrderId: '1000584805' }).lean()
    expect(order).not.toBeNull()
    expect(order!.source).toBe('YATRIRESTRO')
    expect(order!.status).toBe('RECEIVED')
    expect(order!.stationCode).toBe('CNB')
    expect(order!.amountPaise).toBe(23600)
    expect(order!.rawSeat).toBe('B5-37')
    expect(order!.serviceDate).toBe('2026-08-27')
    expect(order!.gmailMessageId).toBe('gmail-1')
    // Plan §6: store the full raw body before parsing anything.
    expect((order!.rawPayload as { body: string }).body).toContain('YatriRestro')
    expect(order!.events).toHaveLength(1)
  })

  it('treats a replayed message as an idempotent no-op, not an error', async () => {
    const first = await ingestEmail(email(fx.SAMPLE_WITH_EMOJI, 'gmail-1'))
    expect(first.status).toBe('CREATED')

    // Gmail history sync replays the same message; this is normal.
    const second = await ingestEmail(email(fx.SAMPLE_WITH_EMOJI, 'gmail-1'))
    expect(second.status).toBe('DUPLICATE')

    expect(await Order.countDocuments({ externalOrderId: '1000584805' })).toBe(1)
  })

  it('deduplicates on externalOrderId even when the message id differs', async () => {
    await ingestEmail(email(fx.SAMPLE_WITH_EMOJI, 'gmail-1'))
    const resent = await ingestEmail(email(fx.SAMPLE_WITH_EMOJI, 'gmail-DIFFERENT'))
    expect(resent.status).toBe('DUPLICATE')
    expect(await Order.countDocuments({})).toBe(1)
  })

  it('files a malformed email in the unparsed inbox instead of dropping it', async () => {
    const r = await ingestEmail(email(fx.MALFORMED_NO_ITEMS, 'gmail-2'))
    expect(r.status).toBe('UNPARSED')
    if (r.status !== 'UNPARSED') return
    expect(r.reason).toBe('MISSING_FIELD')

    expect(await Order.countDocuments({})).toBe(0)
    const row = await UnparsedInbox.findById(r.inboxId).lean()
    expect(row!.resolved).toBe(false)
    // What the parser did understand is kept, so a human is not starting cold.
    expect((row!.partial as { externalOrderId?: string })?.externalOrderId).toBe('1000585222')
  })

  it('refuses to route an unknown outlet to any kitchen', async () => {
    const r = await ingestEmail(email(fx.UNKNOWN_OUTLET, 'gmail-3'))
    expect(r.status).toBe('UNPARSED')
    if (r.status !== 'UNPARSED') return
    expect(r.reason).toBe('UNKNOWN_OUTLET')
    expect(await Order.countDocuments({})).toBe(0)
  })

  it('files an email no parser recognises rather than discarding it', async () => {
    const r = await ingestEmail(email(fx.GARBAGE, 'gmail-4'))
    expect(r.status).toBe('UNPARSED')
    if (r.status !== 'UNPARSED') return
    expect(r.reason).toBe('PARSE_FAILED')
  })

  it('does not pile up inbox rows when the same bad message is replayed', async () => {
    await ingestEmail(email(fx.GARBAGE, 'gmail-4'))
    await ingestEmail(email(fx.GARBAGE, 'gmail-4'))
    expect(await UnparsedInbox.countDocuments({ resolved: false })).toBe(1)
  })

  it('handles a multi-item order end to end', async () => {
    const r = await ingestEmail(email(fx.MULTI_ITEM, 'gmail-5'))
    expect(r.status).toBe('CREATED')

    const order = await Order.findOne({ externalOrderId: '1000584999' }).lean()
    expect(order!.items).toHaveLength(3)
    expect(order!.items.map((i) => i.qty)).toEqual([2, 3, 1])
    expect(order!.items[1].notes).toBe('extra sugar')
    expect(order!.paymentMode).toBe('PREPAID')
  })

  it('routes a "Dear Partner" order (no outlet name in the body) to the YATRI RESTRO outlet', async () => {
    await makeRestaurant('YATRI RESTRO', 'CNB')
    const r = await ingestEmail(email(bookingFx.SAMPLE_PARTNER_NO_OUTLET, 'gmail-6'))
    expect(r.status).toBe('CREATED')

    const order = await Order.findOne({ externalOrderId: '1000591444' }).lean()
    expect(order).not.toBeNull()
    expect(order!.stationCode).toBe('CNB')
  })

  it('still fails closed when the default outlet is not registered at the order\'s station', async () => {
    // Guards against the default silently mis-routing across stations: the
    // fixture's station is CNB, so registering "YATRI RESTRO" elsewhere must
    // still refuse rather than attach the order to the wrong city's kitchen.
    await makeRestaurant('YATRI RESTRO', 'PRYJ')
    const r = await ingestEmail(email(bookingFx.SAMPLE_PARTNER_NO_OUTLET, 'gmail-7'))
    expect(r.status).toBe('UNPARSED')
    if (r.status !== 'UNPARSED') return
    expect(r.reason).toBe('UNKNOWN_OUTLET')
  })
})

describe('outlet matching (plan §6: never guess)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await disconnectDb()
  })

  it('matches on the exact name', async () => {
    await makeRestaurant('HOTEL GANGA GALAXY', 'CNB')
    const m = await matchOutlet('HOTEL GANGA GALAXY', 'CNB')
    expect(m.ok).toBe(true)
  })

  it('matches on an alias, case and spacing insensitive', async () => {
    await makeRestaurant('HOTEL GANGA GALAXY', 'CNB', ['Ganga  Galaxy'])
    const m = await matchOutlet('  ganga galaxy ', 'CNB')
    expect(m.ok).toBe(true)
  })

  it('refuses a near-miss rather than fuzzy-matching it', async () => {
    await makeRestaurant('HOTEL GANGA GALAXY', 'CNB')
    // One character out. Routing to the wrong kitchen is worse than a delay.
    const m = await matchOutlet('HOTEL GANGA GALAXI', 'CNB')
    expect(m.ok).toBe(false)
  })

  it('refuses a right name at the wrong station', async () => {
    await makeRestaurant('HOTEL GANGA GALAXY', 'CNB')
    const m = await matchOutlet('HOTEL GANGA GALAXY', 'PRYJ')
    expect(m.ok).toBe(false)
    if (m.ok) return
    expect(m.detail).toMatch(/registered at CNB/)
  })

  it('disambiguates a shared alias by station when it can', async () => {
    await makeRestaurant('GANGA CNB', 'CNB', ['GANGA'])
    await makeRestaurant('GANGA PRYJ', 'PRYJ', ['GANGA'])
    const m = await matchOutlet('GANGA', 'PRYJ')
    expect(m.ok).toBe(true)
    if (!m.ok) return
    expect(m.name).toBe('GANGA PRYJ')
  })

  it('refuses when a shared alias cannot be disambiguated', async () => {
    await makeRestaurant('GANGA ONE', 'CNB', ['GANGA'])
    await makeRestaurant('GANGA TWO', 'CNB', ['GANGA'])
    const m = await matchOutlet('GANGA', 'CNB')
    expect(m.ok).toBe(false)
    if (m.ok) return
    expect(m.detail).toMatch(/refusing to guess/)
  })

  it('ignores deactivated outlets', async () => {
    const r = await makeRestaurant('HOTEL GANGA GALAXY', 'CNB')
    await r.updateOne({ $set: { active: false } })
    const m = await matchOutlet('HOTEL GANGA GALAXY', 'CNB')
    expect(m.ok).toBe(false)
  })
})
