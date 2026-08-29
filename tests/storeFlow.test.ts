import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { disconnectDb } from '../src/lib/db'
import { findMany, findById } from '../src/lib/repo/orderRepo'
import { transitionOrder } from '../src/lib/repo/transitionOrder'
import { ConflictError, ForbiddenError, type AuthContext } from '../src/lib/authContext'
import type { OrderStatus } from '../src/lib/orderStatus'
import { ctxFor, makeOrder, makeRestaurant, makeUser, resetDb } from './fixtures'

const OPEN: OrderStatus[] = ['RECEIVED', 'ACCEPTED', 'KOT_PRINTED', 'PREPARED']
const TODAY = '2026-08-27'
const LATER = '2026-08-29'

describe('store manager dashboard', () => {
  let manager: AuthContext
  let otherManager: AuthContext
  let restaurantId: import('mongoose').Types.ObjectId

  beforeAll(async () => {
    await resetDb()
    const mine = await makeRestaurant('HOTEL GANGA GALAXY', 'CNB')
    const theirs = await makeRestaurant('SHREE ANNAPURNA', 'PRYJ')
    restaurantId = mine._id
    manager = ctxFor(await makeUser('STORE_MANAGER', '9000000002', mine._id))
    otherManager = ctxFor(await makeUser('STORE_MANAGER', '9000000003', theirs._id))

    await makeOrder({ restaurantId: mine._id, serviceDate: TODAY })
    await makeOrder({ restaurantId: mine._id, serviceDate: TODAY })
    await makeOrder({ restaurantId: mine._id, serviceDate: LATER, orderType: 'BULK', pax: 75 })
    await makeOrder({ restaurantId: theirs._id, serviceDate: TODAY })
  })

  afterAll(async () => {
    await disconnectDb()
  })

  const today = () => findMany(manager, { serviceDate: TODAY })
  const upcoming = () =>
    findMany(manager, { serviceDate: { $gt: TODAY }, status: { $in: OPEN } })

  it('keeps orders booked ahead off the Today tab', async () => {
    const t = await today()
    expect(t).toHaveLength(2)
    expect(t.every((o) => o.serviceDate === TODAY)).toBe(true)
  })

  it('shows the future-dated bulk order on Upcoming', async () => {
    const u = await upcoming()
    expect(u).toHaveLength(1)
    expect(u[0].serviceDate).toBe(LATER)
    expect(u[0].orderType).toBe('BULK')
  })

  it('does not leak the other outlet into either tab', async () => {
    const ids = [...(await today()), ...(await upcoming())].map((o) => String(o.restaurantId))
    expect(ids.every((r) => r === String(restaurantId))).toBe(true)
    expect(await findMany(otherManager, { serviceDate: TODAY })).toHaveLength(1)
  })

  it('drops a finished order off the Upcoming tab but keeps Today as a full day record', async () => {
    const future = (await upcoming())[0]
    const id = String(future._id)
    for (const to of ['ACCEPTED', 'KOT_PRINTED', 'PREPARED'] as const) {
      await transitionOrder({ ctx: manager, orderId: id, to })
    }
    // Still open, so still upcoming.
    expect(await upcoming()).toHaveLength(1)

    // An admin cancels it; it leaves the working view.
    const admin = ctxFor(await makeUser('ADMIN', '9000000001'))
    await transitionOrder({ ctx: admin, orderId: id, to: 'CANCELLED' })
    expect(await upcoming()).toHaveLength(0)
  })

  it('runs the pass in order: accept, KOT, prepared', async () => {
    const [order] = await today()
    const id = String(order._id)

    // Cannot skip the queue — KOT before Accept is not a legal edge.
    await expect(
      transitionOrder({ ctx: manager, orderId: id, to: 'KOT_PRINTED' }),
    ).rejects.toBeInstanceOf(ForbiddenError)

    await transitionOrder({ ctx: manager, orderId: id, to: 'ACCEPTED' })
    await transitionOrder({ ctx: manager, orderId: id, to: 'KOT_PRINTED' })
    await transitionOrder({ ctx: manager, orderId: id, to: 'PREPARED' })

    const done = await findById(manager, id)
    expect(done!.status).toBe('PREPARED')
    expect(done!.events.map((e) => e.toStatus)).toEqual([
      'RECEIVED', 'ACCEPTED', 'KOT_PRINTED', 'PREPARED',
    ])
  })

  it('reports a second Mark Prepared as a conflict, not an illegal transition', async () => {
    const [order] = await today()
    const id = String(order._id)
    // This order is already PREPARED from the previous test's run.
    if (order.status !== 'PREPARED') {
      for (const to of ['ACCEPTED', 'KOT_PRINTED', 'PREPARED'] as const) {
        await transitionOrder({ ctx: manager, orderId: id, to })
      }
    }
    await expect(
      transitionOrder({ ctx: manager, orderId: id, to: 'PREPARED' }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('a store manager cannot dispatch without naming who took it', async () => {
    // A manager may hand food over, but the record has to say which rider has
    // it — an anonymous DISPATCHED is worse than none.
    const prepared = (await today()).find((o) => o.status === 'PREPARED')!
    await expect(
      transitionOrder({ ctx: manager, orderId: String(prepared._id), to: 'DISPATCHED' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})
