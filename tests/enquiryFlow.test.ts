import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { disconnectDb } from '../src/lib/db'
import { createEnquiry } from '../src/lib/repo/createEnquiry'
import { transitionOrder } from '../src/lib/repo/transitionOrder'
import { findById, updateOrderFields, outletAnalytics } from '../src/lib/repo/orderRepo'
import { ConflictError, ForbiddenError, type AuthContext } from '../src/lib/authContext'
import { ctxFor, makeRestaurant, makeUser, resetDb } from './fixtures'
import { parseBulkEnquiry } from '../src/lib/ingest/parsers/bulkEnquiry'

const SAMPLE = `*Query*
Date =03-Sep
Location =Kanpur Central
Train no -
Time  = 7:30PM
Pax = 75
Menu = 2pcs Egg Curry + Dal Fry + Jeera Rice
Advance = 5000 by UPI`

describe('bulk enquiry → quote → confirm', () => {
  let admin: AuthContext
  let manager: AuthContext
  let restaurantId: string
  let enquiryId: string

  beforeAll(async () => {
    await resetDb()
    const r = await makeRestaurant('HOTEL GANGA GALAXY', 'CNB')
    restaurantId = String(r._id)
    admin = ctxFor(await makeUser('ADMIN', '9000000001'))
    manager = ctxFor(await makeUser('STORE_MANAGER', '9000000002', r._id))
  })

  afterAll(async () => {
    await disconnectDb()
  })

  it('creates an enquiry from a pasted message', async () => {
    const parsed = parseBulkEnquiry(SAMPLE, new Date('2026-08-27T08:00:00Z'))
    const doc = await createEnquiry(admin, {
      serviceDate: parsed.serviceDate!,
      stationCode: 'CNB',
      location: parsed.location,
      trainNo: parsed.trainNo,
      pax: parsed.pax,
      menuSpec: parsed.menu,
      scheduledArrival: `${parsed.serviceDate}T${parsed.time}`,
      contactName: null,
      contactPhone: null,
      notes: parsed.notes.join('\n'),
      rawPaste: SAMPLE,
    })
    enquiryId = String(doc._id)

    expect(doc.status).toBe('ENQUIRY')
    expect(doc.orderType).toBe('BULK')
    expect(doc.pax).toBe(75)
    expect(doc.restaurantId).toBeNull()
    // Plan §7: keep the pasted original as the record of what was requested.
    expect((doc.rawPayload as { pastedText: string }).pastedText).toContain('Egg Curry')
    // Nothing the parser did not recognise is dropped.
    expect(doc.notes).toContain('5000')
  })

  it('is invisible to the outlet until confirmed', async () => {
    expect(await findById(manager, enquiryId)).toBeNull()
  })

  it('refuses to confirm before it is quoted', async () => {
    await expect(
      transitionOrder({ ctx: admin, orderId: enquiryId, to: 'RECEIVED' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('quotes it', async () => {
    await transitionOrder({ ctx: admin, orderId: enquiryId, to: 'QUOTED' })
    const o = await findById(admin, enquiryId)
    expect(o!.status).toBe('QUOTED')
  })

  it('the completeness guard blocks confirmation while fields are missing', async () => {
    await expect(
      transitionOrder({ ctx: admin, orderId: enquiryId, to: 'RECEIVED' }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('confirms once every required field is filled in', async () => {
    await updateOrderFields(admin, enquiryId, {
      restaurantId,
      contactPhone: '9839066666',
      amountPaise: 1875000,
      paymentMode: 'INVOICE',
      readyBy: new Date('2026-09-03T13:00:00Z'),
    })
    const confirmed = await transitionOrder({ ctx: admin, orderId: enquiryId, to: 'RECEIVED' })
    expect(confirmed.status).toBe('RECEIVED')
  })

  it('now appears on the outlet dashboard', async () => {
    const seen = await findById(manager, enquiryId)
    expect(seen).not.toBeNull()
    expect(seen!.status).toBe('RECEIVED')
  })

  it('refuses to write status through the field updater', async () => {
    await expect(
      updateOrderFields(admin, enquiryId, { status: 'DELIVERED' }),
    ).rejects.toThrow(/only by transitionOrder/i)
  })

  it('a store manager cannot edit another outlet\'s order through the field updater', async () => {
    const other = await makeRestaurant('SHREE ANNAPURNA', 'PRYJ')
    const otherMgr = ctxFor(await makeUser('STORE_MANAGER', '9000000009', other._id))
    const changed = await updateOrderFields(otherMgr, enquiryId, { notes: 'tampered' })
    expect(changed).toBe(false)
    const o = await findById(admin, enquiryId)
    expect(o!.notes).not.toBe('tampered')
  })
})

describe('analytics', () => {
  let admin: AuthContext
  let manager: AuthContext
  let restaurantId: string

  beforeAll(async () => {
    await resetDb()
    const r = await makeRestaurant('HOTEL GANGA GALAXY', 'CNB')
    const other = await makeRestaurant('SHREE ANNAPURNA', 'PRYJ')
    restaurantId = String(r._id)
    admin = ctxFor(await makeUser('ADMIN', '9000000001'))
    manager = ctxFor(await makeUser('STORE_MANAGER', '9000000002', r._id))

    const agent = await makeUser('DELIVERY_AGENT', '9000000004', r._id)
    const agentCtx = ctxFor(agent)

    const { makeOrder } = await import('./fixtures')

    // Two delivered at one outlet, one failed, one untouched at the other.
    for (const [i, outcome] of (['DELIVERED', 'DELIVERED', 'FAILED'] as const).entries()) {
      const o = await makeOrder({
        restaurantId: r._id, serviceDate: '2026-08-27', trainNo: '12506',
        stationCode: 'CNB', coach: `B${i + 1}`, amountPaise: 20000,
      })
      const id = String(o._id)
      for (const to of ['ACCEPTED', 'KOT_PRINTED', 'PREPARED'] as const) {
        await transitionOrder({ ctx: manager, orderId: id, to })
      }
      await transitionOrder({ ctx: agentCtx, orderId: id, to: 'DISPATCHED' })
      await transitionOrder({
        ctx: agentCtx, orderId: id, to: outcome,
        apply: outcome === 'DELIVERED'
          ? { proofType: 'SIGNATURE', proofValue: 'Someone' }
          : { failureReason: 'not at seat' },
      })
    }
    await makeOrder({ restaurantId: other._id, serviceDate: '2026-08-27', amountPaise: 50000 })
  })

  afterAll(async () => {
    await disconnectDb()
  })

  it('reports per-outlet delivery success and value', async () => {
    const rows = await outletAnalytics(admin, { from: '2026-08-01', to: '2026-08-31' })
    const mine = rows.find((r) => r.restaurantId === restaurantId)!
    expect(mine.orders).toBe(3)
    expect(mine.delivered).toBe(2)
    expect(mine.failed).toBe(1)
    // Only delivered orders count toward value.
    expect(mine.revenuePaise).toBe(40000)
    expect(mine.avgReceivedToDeliveredMinutes).not.toBeNull()
  })

  it('covers every outlet for an admin', async () => {
    const rows = await outletAnalytics(admin, { from: '2026-08-01', to: '2026-08-31' })
    expect(rows).toHaveLength(2)
  })

  it('stays scoped — a store manager sees only their own outlet', async () => {
    const rows = await outletAnalytics(manager, { from: '2026-08-01', to: '2026-08-31' })
    expect(rows).toHaveLength(1)
    expect(rows[0].restaurantId).toBe(restaurantId)
  })

  it('excludes orders outside the date range', async () => {
    const rows = await outletAnalytics(admin, { from: '2026-09-01', to: '2026-09-30' })
    expect(rows).toHaveLength(0)
  })
})
