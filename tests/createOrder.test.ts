import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { disconnectDb } from '../src/lib/db'
import { createManualOrder } from '../src/lib/repo/createOrder'
import { findById } from '../src/lib/repo/orderRepo'
import { ForbiddenError, type AuthContext } from '../src/lib/authContext'
import { ManualOrderInput } from '../src/lib/validation/order'
import { ctxFor, makeRestaurant, makeUser, resetDb } from './fixtures'

describe('createManualOrder', () => {
  let admin: AuthContext
  let manager: AuthContext
  let outletId: string

  beforeAll(async () => {
    await resetDb()
    const r = await makeRestaurant('HOTEL GANGA GALAXY', 'CNB')
    outletId = String(r._id)
    admin = ctxFor(await makeUser('ADMIN', '9000000001'))
    manager = ctxFor(await makeUser('STORE_MANAGER', '9000000002', r._id))
  })

  afterAll(async () => {
    await disconnectDb()
  })

  const retail = (over: Record<string, unknown> = {}) =>
    ManualOrderInput.parse({
      orderType: 'RETAIL',
      restaurantId: outletId,
      serviceDate: '2026-08-27',
      trainNo: '12506',
      trainName: 'NORTH EAST EXP',
      scheduledArrival: '2026-08-27T13:25',
      coach: 'B5',
      berth: '37',
      contactName: 'Neelesh Soni',
      contactPhone: '9752446747',
      amountRupees: '236',
      paymentMode: 'COD',
      items: [{ name: 'Paneer Paratha With Curd Combo', qty: 1, priceRupees: '236', isPacking: false }],
      ...over,
    })

  it('creates a retail order matching the plan sample', async () => {
    const o = await createManualOrder(admin, retail())
    expect(o.status).toBe('RECEIVED')
    expect(o.source).toBe('MANUAL')
    expect(o.amountPaise).toBe(23600)
    expect(o.rawSeat).toBe('B5-37')
    expect(o.timingSource).toBe('SCHEDULED')
    // 13:25 IST is 07:55 UTC — the conversion the whole system depends on.
    expect(o.scheduledArrival?.toISOString()).toBe('2026-08-27T07:55:00.000Z')
    expect(o.externalOrderId).toMatch(/^MAN-20260827-\d{3}$/)
    // Birth event, so the trail starts at creation rather than first accept.
    expect(o.events).toHaveLength(1)
    expect(o.events[0].toStatus).toBe('RECEIVED')
    expect(o.events[0].fromStatus).toBeNull()
  })

  it('mints sequential ids per service date', async () => {
    const a = await createManualOrder(admin, retail())
    const b = await createManualOrder(admin, retail())
    const c = await createManualOrder(admin, retail({ serviceDate: '2026-08-28' }))

    const seqA = Number(a.externalOrderId.split('-')[2])
    const seqB = Number(b.externalOrderId.split('-')[2])
    expect(seqB).toBe(seqA + 1)
    // A new date restarts its own sequence.
    expect(c.externalOrderId).toMatch(/^MAN-20260828-001$/)
  })

  it('keeps a bulk thali as ONE item with qty = pax, not one row per component', async () => {
    const menu = '2pcs Egg Curry + Dry aloo jeera + Dal Fry + Jeera Rice + 3 Butter Roti'
    const o = await createManualOrder(
      admin,
      ManualOrderInput.parse({
        orderType: 'BULK',
        restaurantId: outletId,
        serviceDate: '2026-09-03',
        pax: 75,
        menuSpec: menu,
        readyBy: '2026-09-03T19:00',
        handoverPoint: 'coach B5 door, contact Mr Sharma',
        contactPhone: '9000000123',
        amountRupees: '18750',
        paymentMode: 'INVOICE',
        packingItems: ['Water bottle 500ml', 'Tissue'],
      }),
    )

    const kitchen = o.items.filter((i) => !i.isPacking)
    expect(kitchen).toHaveLength(1)
    expect(kitchen[0].qty).toBe(75)
    expect(kitchen[0].spec).toBe(menu)

    const packing = o.items.filter((i) => i.isPacking)
    expect(packing.map((p) => p.name)).toEqual(['Water bottle 500ml', 'Tissue'])
    expect(o.pax).toBe(75)
    expect(o.coach).toBeNull()
    expect(o.handoverPoint).toContain('Mr Sharma')
  })

  it('lets a store manager create into an outlet they hold', async () => {
    const doc = await createManualOrder(manager, retail())
    expect(String(doc.restaurantId)).toBe(outletId)
    expect(String(doc.createdById)).toBe(String(manager.userId))
  })

  it('refuses a store manager an outlet they do not hold', async () => {
    const other = await makeRestaurant('SHREE ANNAPURNA', 'PRYJ')
    await expect(
      createManualOrder(manager, retail({ restaurantId: String(other._id) })),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('refuses a delivery agent outright', async () => {
    const agent = ctxFor(await makeUser('DELIVERY_AGENT', '9000000003'))
    await expect(createManualOrder(agent, retail())).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('refuses an outlet that does not exist', async () => {
    await expect(
      createManualOrder(admin, retail({ restaurantId: '000000000000000000000000' })),
    ).rejects.toThrow(/does not exist/i)
  })

  it('rejects a bulk order missing pax, menu, readyBy or handover point', () => {
    const r = ManualOrderInput.safeParse({
      orderType: 'BULK',
      restaurantId: outletId,
      serviceDate: '2026-09-03',
      items: [],
    })
    expect(r.success).toBe(false)
    const paths = r.success ? [] : r.error.issues.map((i) => i.path.join('.'))
    expect(paths).toEqual(expect.arrayContaining(['pax', 'menuSpec', 'readyBy', 'handoverPoint']))
  })

  it('rejects a retail order with no items', () => {
    const r = ManualOrderInput.safeParse({
      orderType: 'RETAIL', restaurantId: outletId, serviceDate: '2026-08-27', items: [],
    })
    expect(r.success).toBe(false)
  })

  it('the created order is visible to its own outlet manager and nobody else', async () => {
    const o = await createManualOrder(admin, retail())
    expect(await findById(manager, String(o._id))).not.toBeNull()

    const other = await makeRestaurant('SHREE ANNAPURNA', 'PRYJ')
    const otherMgr = ctxFor(await makeUser('STORE_MANAGER', '9000000009', other._id))
    expect(await findById(otherMgr, String(o._id))).toBeNull()
  })
})
