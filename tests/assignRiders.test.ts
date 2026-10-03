import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { disconnectDb } from '../src/lib/db'
import { findById } from '../src/lib/repo/orderRepo'
import { assignRiders, listAssignableRiders, transitionOrder } from '../src/lib/repo/transitionOrder'
import { User } from '../src/lib/models'
import { ConflictError, ForbiddenError, NotFoundError, type AuthContext } from '../src/lib/authContext'
import { ctxFor, makeOrder, makeRestaurant, makeUser, resetDb } from './fixtures'

/**
 * The office routes an order to a rider. The rider's app only ever shows what
 * was assigned, so a wrong assignment is a missing or leaked order.
 */
describe('assigning riders to one order', () => {
  let ganga: import('mongoose').Types.ObjectId
  let other: import('mongoose').Types.ObjectId
  let telecaller: AuthContext
  let manager: AuthContext
  let admin: AuthContext
  let riderA: import('mongoose').Types.ObjectId
  let riderB: import('mongoose').Types.ObjectId
  let farRider: import('mongoose').Types.ObjectId
  let idleRider: import('mongoose').Types.ObjectId

  beforeAll(async () => {
    await resetDb()
    ganga = (await makeRestaurant('HOTEL GANGA GALAXY', 'CNB'))._id
    other = (await makeRestaurant('SHREE ANNAPURNA', 'PRYJ'))._id
    telecaller = ctxFor(await makeUser('TELECALLER', '9300000001', ganga))
    manager = ctxFor(await makeUser('STORE_MANAGER', '9300000002', ganga))
    admin = ctxFor(await makeUser('ADMIN', '9300000003'))
    riderA = (await makeUser('DELIVERY_AGENT', '9300000004', ganga))._id
    riderB = (await makeUser('DELIVERY_AGENT', '9300000005', ganga))._id
    farRider = (await makeUser('DELIVERY_AGENT', '9300000006', other))._id
    idleRider = (await makeUser('DELIVERY_AGENT', '9300000007', ganga))._id
    await User.updateOne({ _id: idleRider }, { active: false })
  })

  afterAll(async () => {
    await disconnectDb()
  })

  async function newOrder(overrides: Record<string, unknown> = {}) {
    return String((await makeOrder({ restaurantId: ganga, ...overrides }))._id)
  }

  it('a telecaller assigns a rider, audited on the event log', async () => {
    const id = await newOrder({ status: 'KOT_PRINTED' })
    const out = await assignRiders({ ctx: telecaller, orderId: id, riderIds: [String(riderA)] })
    expect(out.delivery.agentIds.map(String)).toEqual([String(riderA)])
    expect(out.delivery.assignedAt).toBeInstanceOf(Date)
    expect(out.status).toBe('KOT_PRINTED')
    expect(out.events.at(-1)!.meta).toMatchObject({ action: 'ASSIGN_RIDERS' })
  })

  it('a store manager and an admin can assign too, and two riders are valid', async () => {
    const id = await newOrder({ status: 'PREPARED' })
    const byManager = await assignRiders({ ctx: manager, orderId: id, riderIds: [String(riderA)] })
    expect(byManager.delivery.agentIds.map(String)).toEqual([String(riderA)])
    const byAdmin = await assignRiders({
      ctx: admin,
      orderId: id,
      riderIds: [String(riderA), String(riderB)],
    })
    expect(byAdmin.delivery.agentIds.map(String)).toEqual([String(riderA), String(riderB)])
  })

  it('reassigning replaces the rider, and an empty list takes the order off everyone', async () => {
    const id = await newOrder({ status: 'PREPARED' })
    await assignRiders({ ctx: telecaller, orderId: id, riderIds: [String(riderA)] })
    const moved = await assignRiders({ ctx: telecaller, orderId: id, riderIds: [String(riderB)] })
    expect(moved.delivery.agentIds.map(String)).toEqual([String(riderB)])
    const cleared = await assignRiders({ ctx: telecaller, orderId: id, riderIds: [] })
    expect(cleared.delivery.agentIds).toEqual([])
    expect(cleared.delivery.assignedAt).toBeNull()
  })

  it('a riders only sees the order once it is assigned to them', async () => {
    const id = await newOrder({ status: 'PREPARED' })
    const rider = ctxFor({ _id: riderA, role: 'DELIVERY_AGENT', restaurantIds: [ganga] })
    expect(await findById(rider, id)).toBeNull()
    await assignRiders({ ctx: telecaller, orderId: id, riderIds: [String(riderA)] })
    expect(await findById(rider, id)).not.toBeNull()
    await transitionOrder({ ctx: rider, orderId: id, to: 'DISPATCHED' })
  })

  it('refuses a rider from another outlet, or an inactive one, for the office', async () => {
    const id = await newOrder({ status: 'PREPARED' })
    await expect(
      assignRiders({ ctx: telecaller, orderId: id, riderIds: [String(farRider)] }),
    ).rejects.toBeInstanceOf(ConflictError)
    await expect(
      assignRiders({ ctx: manager, orderId: id, riderIds: [String(idleRider)] }),
    ).rejects.toBeInstanceOf(ConflictError)
    await expect(
      assignRiders({ ctx: telecaller, orderId: id, riderIds: ['not-an-id'] }),
    ).rejects.toBeInstanceOf(ConflictError)
    expect((await findById(admin, id))!.delivery.agentIds).toEqual([])
  })

  it('an admin may pick a rider from any outlet, but not an inactive one', async () => {
    const id = await newOrder({ status: 'PREPARED' })
    const out = await assignRiders({ ctx: admin, orderId: id, riderIds: [String(farRider)] })
    expect(out.delivery.agentIds.map(String)).toEqual([String(farRider)])
    await expect(
      assignRiders({ ctx: admin, orderId: id, riderIds: [String(idleRider)] }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('refuses a closed order', async () => {
    const id = await newOrder({ status: 'DELIVERED' })
    await expect(
      assignRiders({ ctx: telecaller, orderId: id, riderIds: [String(riderA)] }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('treats another outlet\'s order as missing, and a rider cannot assign', async () => {
    const theirs = String((await makeOrder({ restaurantId: other, status: 'PREPARED' }))._id)
    await expect(
      assignRiders({ ctx: telecaller, orderId: theirs, riderIds: [String(riderA)] }),
    ).rejects.toBeInstanceOf(NotFoundError)
    const rider = ctxFor({ _id: riderA, role: 'DELIVERY_AGENT', restaurantIds: [ganga] })
    const mine = await newOrder({ status: 'PREPARED' })
    await expect(
      assignRiders({ ctx: rider, orderId: mine, riderIds: [String(riderA)] }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('lists only active riders at the outlet', async () => {
    const list = await listAssignableRiders(ganga)
    expect(list.map((r) => r.id).sort()).toEqual([String(riderA), String(riderB)].sort())
  })
})
