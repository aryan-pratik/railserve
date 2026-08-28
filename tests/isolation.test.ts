import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { disconnectDb } from '../src/lib/db'
import { findById, findMany, countByStatus } from '../src/lib/repo/orderRepo'
import { transitionOrder } from '../src/lib/repo/transitionOrder'
import { NotFoundError } from '../src/lib/authContext'
import { ctxFor, makeOrder, makeRestaurant, makeUser, resetDb } from './fixtures'
import type { AuthContext } from '../src/lib/authContext'

/**
 * Plan §2 / §5: "Write an integration test that logs in as store manager A and
 * asserts a 404 on an order belonging to store B, by ID. Treat that test as a
 * release blocker."
 */
describe('cross-tenant store isolation', () => {
  let adminCtx: AuthContext
  let managerA: AuthContext
  let managerB: AuthContext
  let agent1: AuthContext
  let agent2: AuthContext
  let orderA: string
  let orderB: string

  beforeAll(async () => {
    await resetDb()

    const ganga = await makeRestaurant('HOTEL GANGA GALAXY', 'CNB')
    const annapurna = await makeRestaurant('SHREE ANNAPURNA', 'PRYJ')

    adminCtx = ctxFor(await makeUser('ADMIN', '9000000001'))
    managerA = ctxFor(await makeUser('STORE_MANAGER', '9000000002', ganga._id))
    managerB = ctxFor(await makeUser('STORE_MANAGER', '9000000003', annapurna._id))
    // Riders are scoped by outlet, not by assignment — one per station here.
    const a1 = await makeUser('DELIVERY_AGENT', '9000000004', ganga._id)
    const a2 = await makeUser('DELIVERY_AGENT', '9000000005', annapurna._id)
    agent1 = ctxFor(a1)
    agent2 = ctxFor(a2)

    const oa = await makeOrder({
      restaurantId: ganga._id,
      stationCode: 'CNB',
      delivery: { agentIds: [a1._id] },
    })
    const ob = await makeOrder({ restaurantId: annapurna._id, stationCode: 'PRYJ' })
    orderA = String(oa._id)
    orderB = String(ob._id)
  })

  afterAll(async () => {
    await disconnectDb()
  })

  it('store manager A gets nothing for store B order by ID (the 404 case)', async () => {
    expect(await findById(managerA, orderB)).toBeNull()
  })

  it('store manager B gets nothing for store A order by ID', async () => {
    expect(await findById(managerB, orderA)).toBeNull()
  })

  it('each store manager sees exactly their own outlet in list views', async () => {
    const listA = await findMany(managerA)
    const listB = await findMany(managerB)
    expect(listA.map((o) => String(o._id))).toEqual([orderA])
    expect(listB.map((o) => String(o._id))).toEqual([orderB])
  })

  it('store manager can read their own order by ID', async () => {
    const own = await findById(managerA, orderA)
    expect(own).not.toBeNull()
    expect(String(own!._id)).toBe(orderA)
  })

  it('admin sees both outlets', async () => {
    const all = await findMany(adminCtx)
    expect(all.map((o) => String(o._id)).sort()).toEqual([orderA, orderB].sort())
  })

  it('aggregation is scoped too, not just find', async () => {
    expect(await countByStatus(managerA)).toEqual({ RECEIVED: 1 })
    expect(await countByStatus(adminCtx)).toEqual({ RECEIVED: 2 })
  })

  it('a rider sees their own kitchen and no other', async () => {
    // Nobody assigned these. The rider at Ganga sees Ganga's order because it
    // is Ganga's, and the rider at Annapurna cannot reach it by id.
    expect((await findMany(agent1)).map((o) => String(o._id))).toEqual([orderA])
    expect((await findMany(agent2)).map((o) => String(o._id))).toEqual([orderB])
    expect(await findById(agent2, orderA)).toBeNull()
    expect(await findById(agent1, orderB)).toBeNull()
  })

  it('a rider cannot transition another outlet order, even with its ID', async () => {
    await expect(
      transitionOrder({ ctx: agent2, orderId: orderA, to: 'DISPATCHED' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('a store manager cannot transition another outlet order, even with its ID', async () => {
    await expect(
      transitionOrder({ ctx: managerA, orderId: orderB, to: 'ACCEPTED' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('a user with no outlets sees nothing, rather than everything', async () => {
    // A misconfigured manager or rider must fail closed. An empty scope filter
    // here would silently promote them to admin.
    for (const role of ['STORE_MANAGER', 'DELIVERY_AGENT'] as const) {
      const orphan: AuthContext = {
        userId: new mongoose.Types.ObjectId(),
        role,
        restaurantIds: [],
      }
      expect(await findMany(orphan)).toEqual([])
      expect(await findById(orphan, orderA)).toBeNull()
    }
  })

  it('a malformed order id is a miss, not a crash', async () => {
    expect(await findById(managerA, 'not-an-objectid')).toBeNull()
  })
})

/**
 * A manager may run several outlets. The scope must widen to exactly those and
 * stop there — the failure worth guarding against is a multi-outlet manager
 * quietly becoming an admin.
 */
describe('multi-outlet store managers', () => {
  let bothCtx: AuthContext
  let singleCtx: AuthContext
  let orderGanga: string
  let orderAnnapurna: string
  let orderThird: string

  beforeAll(async () => {
    await resetDb()

    const ganga = await makeRestaurant('HOTEL GANGA GALAXY', 'CNB')
    const annapurna = await makeRestaurant('SHREE ANNAPURNA', 'PRYJ')
    const third = await makeRestaurant('COSMOZIN LOUNGE', 'LKO')

    bothCtx = ctxFor(await makeUser('STORE_MANAGER', '9000000010', [ganga._id, annapurna._id]))
    singleCtx = ctxFor(await makeUser('STORE_MANAGER', '9000000011', ganga._id))

    orderGanga = String(await makeOrder({ restaurantId: ganga._id, stationCode: 'CNB' }).then((o) => o._id))
    orderAnnapurna = String(await makeOrder({ restaurantId: annapurna._id, stationCode: 'PRYJ' }).then((o) => o._id))
    orderThird = String(await makeOrder({ restaurantId: third._id, stationCode: 'LKO' }).then((o) => o._id))
  })

  afterAll(async () => {
    await disconnectDb()
  })

  it('sees every outlet they hold, on one board', async () => {
    const ids = (await findMany(bothCtx)).map((o) => String(o._id)).sort()
    expect(ids).toEqual([orderGanga, orderAnnapurna].sort())
  })

  it('still cannot reach an outlet they do not hold', async () => {
    expect(await findById(bothCtx, orderThird)).toBeNull()
    await expect(
      transitionOrder({ ctx: bothCtx, orderId: orderThird, to: 'ACCEPTED' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('holding two outlets does not widen a single-outlet colleague', async () => {
    const ids = (await findMany(singleCtx)).map((o) => String(o._id))
    expect(ids).toEqual([orderGanga])
  })

  it('counts aggregate across held outlets only', async () => {
    expect(await countByStatus(bothCtx)).toEqual({ RECEIVED: 2 })
    expect(await countByStatus(singleCtx)).toEqual({ RECEIVED: 1 })
  })
})
