import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type mongoose from 'mongoose'
import { disconnectDb } from '../src/lib/db'
import { User } from '../src/lib/models'
import { findById } from '../src/lib/repo/orderRepo'
import { correctRiderOutcome, transitionOrder } from '../src/lib/repo/transitionOrder'
import {
  countPendingReturns,
  listReturns,
  markReturnedToOrigin,
  mayCollectReturns,
  viewReturn,
} from '../src/lib/repo/rtoRepo'
import { canCollectReturns, opensReturn } from '../src/lib/rto'
import { ConflictError, ForbiddenError, NotFoundError, type AuthContext } from '../src/lib/authContext'
import { assignRider, ctxFor, makeOrder, makeRestaurant, makeUser, resetDb } from './fixtures'

/**
 * Return to origin: an order cancelled or not delivered after a rider took
 * it has to come back to the outlet it left, and someone at that counter
 * marks it returned. Which manager may do that is a tick on their staff
 * record, set by an admin.
 */
describe('return to origin', () => {
  let manager: AuthContext
  let untickedManager: AuthContext
  let otherManager: AuthContext
  let telecaller: AuthContext
  let admin: AuthContext
  let rider: AuthContext
  let ganga: mongoose.Types.ObjectId

  beforeAll(async () => {
    await resetDb()
    ganga = (await makeRestaurant('HOTEL GANGA GALAXY', 'CNB'))._id
    const annapurna = (await makeRestaurant('SHREE ANNAPURNA', 'PRYJ'))._id

    manager = ctxFor(await allowedManager('9200000001', ganga))
    untickedManager = ctxFor(await makeUser('STORE_MANAGER', '9200000007', ganga))
    otherManager = ctxFor(await allowedManager('9200000002', annapurna))
    telecaller = ctxFor(await makeUser('TELECALLER', '9200000003', ganga))
    admin = ctxFor(await makeUser('ADMIN', '9200000004'))
    rider = ctxFor(await makeUser('DELIVERY_AGENT', '9200000005', ganga))
  })

  afterAll(async () => {
    await disconnectDb()
  })

  /** A store manager an admin has ticked "collects returns" for. */
  async function allowedManager(phone: string, outlet: mongoose.Types.ObjectId) {
    const u = await makeUser('STORE_MANAGER', phone, outlet)
    await User.updateOne({ _id: u._id }, { $set: { canCollectReturns: true } })
    return u
  }

  /** An order in the rider's hands, exactly as the pipeline gets it there. */
  async function dispatchedOrder() {
    const id = String((await makeOrder({ restaurantId: ganga, stationCode: 'CNB', status: 'PREPARED' }))._id)
    await assignRider(id, rider.userId)
    await transitionOrder({ ctx: rider, orderId: id, to: 'DISPATCHED' })
    return id
  }

  it('is opened only by leaving DISPATCHED for a non-delivery', () => {
    expect(opensReturn('DISPATCHED', 'CANCELLED')).toBe(true)
    expect(opensReturn('DISPATCHED', 'FAILED')).toBe(true)
    expect(opensReturn('DISPATCHED', 'MISSED_DELIVERY')).toBe(true)
    expect(opensReturn('DISPATCHED', 'DELIVERED')).toBe(false)
    expect(opensReturn('DISPATCHED', 'MISDELIVERY')).toBe(false)
    expect(opensReturn('DISPATCHED', 'PREPARED')).toBe(false)
    expect(opensReturn('PREPARED', 'CANCELLED')).toBe(false)
  })

  it('opens when the rider cannot deliver', async () => {
    const id = await dispatchedOrder()
    await transitionOrder({ ctx: rider, orderId: id, to: 'FAILED', apply: { failureReason: 'Train did not halt' } })

    const order = (await findById(admin, id))!
    expect(order.status).toBe('FAILED')
    expect(order.delivery.rto).toMatchObject({ status: 'PENDING', reason: 'FAILED', returnedAt: null })
    expect(await countPendingReturns(manager)).toBeGreaterThan(0)
  })

  it('opens when the office cancels food already on its way, but not food still in the kitchen', async () => {
    const out = await dispatchedOrder()
    await transitionOrder({ ctx: telecaller, orderId: out, to: 'CANCELLED', meta: { reason: 'Diverted' } })
    expect((await findById(admin, out))!.delivery.rto).toMatchObject({ status: 'PENDING', reason: 'CANCELLED' })

    const cooking = String((await makeOrder({ restaurantId: ganga, stationCode: 'CNB' }))._id)
    await transitionOrder({ ctx: telecaller, orderId: cooking, to: 'CANCELLED', meta: { reason: 'Passenger' } })
    expect((await findById(admin, cooking))!.delivery.rto ?? null).toBeNull()
  })

  it('does not open when a rider puts a mistaken pickup back on the counter', async () => {
    const id = await dispatchedOrder()
    await transitionOrder({ ctx: rider, orderId: id, to: 'PREPARED' })
    expect((await findById(admin, id))!.delivery.rto ?? null).toBeNull()
  })

  it('is closed by the store manager at the origin outlet, once, and audited', async () => {
    const id = await dispatchedOrder()
    await transitionOrder({ ctx: rider, orderId: id, to: 'FAILED', apply: { failureReason: 'No one at seat' } })

    const updated = await markReturnedToOrigin({ ctx: manager, orderId: id, note: '  Two of three thalis  ' })
    expect(updated.status).toBe('FAILED')
    expect(updated.delivery.rto).toMatchObject({
      status: 'RETURNED',
      note: 'Two of three thalis',
      returnedBy: manager.userId,
    })
    expect(updated.delivery.rto!.returnedAt).toBeInstanceOf(Date)
    expect(updated.events.at(-1)!.meta).toMatchObject({
      action: 'RTO_RETURNED',
      reason: 'FAILED',
      note: 'Two of three thalis',
      riderIds: [String(rider.userId)],
    })
    expect(updated.events.at(-1)!.fromStatus).toBe('FAILED')
    expect(updated.events.at(-1)!.toStatus).toBe('FAILED')

    await expect(markReturnedToOrigin({ ctx: manager, orderId: id })).rejects.toBeInstanceOf(ConflictError)

    const view = await viewReturn(updated)
    expect(view).toMatchObject({
      status: 'RETURNED',
      returnedBy: 'STORE_MANAGER 9200000001 · Store manager',
      riders: ['DELIVERY_AGENT 9200000005'],
    })
  })

  it('refuses an order with nothing to return', async () => {
    const id = String((await makeOrder({ restaurantId: ganga, stationCode: 'CNB' }))._id)
    await expect(markReturnedToOrigin({ ctx: manager, orderId: id })).rejects.toBeInstanceOf(ConflictError)
  })

  it('keeps another outlet out, and keeps the rider from marking their own return', async () => {
    const id = await dispatchedOrder()
    await transitionOrder({ ctx: rider, orderId: id, to: 'FAILED', apply: { failureReason: 'Late' } })

    await expect(markReturnedToOrigin({ ctx: otherManager, orderId: id })).rejects.toBeInstanceOf(NotFoundError)
    await expect(markReturnedToOrigin({ ctx: rider, orderId: id })).rejects.toBeInstanceOf(ForbiddenError)
    expect((await findById(admin, id))!.delivery.rto!.status).toBe('PENDING')
  })

  it('lets only a manager an admin has ticked collect; the admin always can', async () => {
    expect(canCollectReturns({ role: 'ADMIN' })).toBe(true)
    expect(canCollectReturns({ role: 'STORE_MANAGER', canCollectReturns: true })).toBe(true)
    expect(canCollectReturns({ role: 'STORE_MANAGER', canCollectReturns: false })).toBe(false)
    expect(canCollectReturns({ role: 'STORE_MANAGER' })).toBe(false)
    expect(canCollectReturns({ role: 'TELECALLER', canCollectReturns: true })).toBe(false)
    expect(canCollectReturns({ role: 'DELIVERY_AGENT', canCollectReturns: true })).toBe(false)

    expect(await mayCollectReturns(manager)).toBe(true)
    expect(await mayCollectReturns(untickedManager)).toBe(false)
    expect(await mayCollectReturns(telecaller)).toBe(false)
    expect(await mayCollectReturns(admin)).toBe(true)

    const id = await dispatchedOrder()
    await transitionOrder({ ctx: rider, orderId: id, to: 'FAILED', apply: { failureReason: 'Late' } })

    // Same outlet, no tick: refused, with the bag still out.
    await expect(markReturnedToOrigin({ ctx: untickedManager, orderId: id })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(markReturnedToOrigin({ ctx: telecaller, orderId: id })).rejects.toBeInstanceOf(ForbiddenError)
    expect((await findById(admin, id))!.delivery.rto!.status).toBe('PENDING')

    // The tick is read fresh, so granting it takes effect on the next click.
    await User.updateOne({ _id: untickedManager.userId }, { $set: { canCollectReturns: true } })
    await markReturnedToOrigin({ ctx: untickedManager, orderId: id })
    expect((await findById(admin, id))!.delivery.rto!.status).toBe('RETURNED')
    await User.updateOne({ _id: untickedManager.userId }, { $set: { canCollectReturns: false } })

    // Nobody ticked at all: still the admin.
    const another = await dispatchedOrder()
    await transitionOrder({ ctx: rider, orderId: another, to: 'FAILED', apply: { failureReason: 'Late' } })
    await markReturnedToOrigin({ ctx: admin, orderId: another })
  })

  it('lists what is still out, oldest first, within the caller\'s outlets', async () => {
    await resetDb()
    ganga = (await makeRestaurant('HOTEL GANGA GALAXY', 'CNB'))._id
    const annapurna = (await makeRestaurant('SHREE ANNAPURNA', 'PRYJ'))._id
    manager = ctxFor(await allowedManager('9200000001', ganga))
    otherManager = ctxFor(await allowedManager('9200000002', annapurna))
    admin = ctxFor(await makeUser('ADMIN', '9200000004'))
    rider = ctxFor(await makeUser('DELIVERY_AGENT', '9200000005', ganga))

    const first = await dispatchedOrder()
    await transitionOrder({ ctx: rider, orderId: first, to: 'FAILED', apply: { failureReason: 'a' } })
    const second = await dispatchedOrder()
    await transitionOrder({ ctx: admin, orderId: second, to: 'CANCELLED', meta: { reason: 'b' } })

    const pending = await listReturns(manager, { status: 'PENDING', limit: 10, skip: 0 })
    expect(pending.total).toBe(2)
    expect(pending.rows.map((r) => r.id)).toEqual([first, second])
    expect(pending.rows[0]).toMatchObject({
      reason: 'FAILED',
      status: 'FAILED',
      riders: ['DELIVERY_AGENT 9200000005'],
      outletName: 'HOTEL GANGA GALAXY',
      codPaise: 12000,
      itemCount: 1,
    })
    expect(await countPendingReturns(manager)).toBe(2)
    expect(await countPendingReturns(otherManager)).toBe(0)
    expect((await listReturns(otherManager, { status: 'PENDING', limit: 10, skip: 0 })).total).toBe(0)

    // Paged, so the second page is the second bag.
    const page2 = await listReturns(manager, { status: 'PENDING', limit: 1, skip: 1 })
    expect(page2.rows.map((r) => r.id)).toEqual([second])

    await markReturnedToOrigin({ ctx: manager, orderId: second })
    const collected = await listReturns(manager, { status: 'RETURNED', limit: 10, skip: 0 })
    expect(collected.rows.map((r) => r.id)).toEqual([second])
    expect(collected.rows[0].returnedBy).toBe('STORE_MANAGER 9200000001')
    expect(await countPendingReturns(manager)).toBe(1)
  })

  describe('rider corrections', () => {
    it('clears a pending return when the order turns out delivered after all', async () => {
      const id = await dispatchedOrder()
      await transitionOrder({ ctx: rider, orderId: id, to: 'FAILED', apply: { failureReason: 'Mistap' } })
      expect((await findById(admin, id))!.delivery.rto!.status).toBe('PENDING')

      await correctRiderOutcome({ ctx: rider, orderId: id, from: 'FAILED', to: 'DELIVERED', receivedBy: 'Passenger' })
      const order = (await findById(admin, id))!
      expect(order.status).toBe('DELIVERED')
      expect(order.delivery.rto ?? null).toBeNull()
    })

    it('opens a return when a delivery is corrected to not delivered', async () => {
      const id = await dispatchedOrder()
      await transitionOrder({ ctx: rider, orderId: id, to: 'DELIVERED', apply: { proofType: 'SIGNATURE', proofValue: 'P' } })
      expect((await findById(admin, id))!.delivery.rto ?? null).toBeNull()

      await correctRiderOutcome({ ctx: rider, orderId: id, from: 'DELIVERED', to: 'FAILED', reason: 'Wrong tap' })
      expect((await findById(admin, id))!.delivery.rto).toMatchObject({ status: 'PENDING', reason: 'FAILED' })
    })

    it("opens a return as not delivered when the rider's word is 'cancelled'", async () => {
      const id = await dispatchedOrder()
      await transitionOrder({ ctx: rider, orderId: id, to: 'DELIVERED', apply: { proofType: 'SIGNATURE', proofValue: 'P' } })

      await correctRiderOutcome({ ctx: rider, orderId: id, from: 'DELIVERED', to: 'CANCELLED', reason: 'Passenger refused' })
      const order = (await findById(admin, id))!
      // CANCELLED is the office's status; the rider's cancel is a failed delivery.
      expect(order.status).toBe('FAILED')
      expect(order.delivery.rto).toMatchObject({ status: 'PENDING', reason: 'FAILED' })
    })

    it('refuses "delivered" once the outlet has the bag back', async () => {
      const id = await dispatchedOrder()
      await transitionOrder({ ctx: rider, orderId: id, to: 'FAILED', apply: { failureReason: 'x' } })
      await markReturnedToOrigin({ ctx: manager, orderId: id })

      await expect(
        correctRiderOutcome({ ctx: rider, orderId: id, from: 'FAILED', to: 'DELIVERED', receivedBy: 'P' }),
      ).rejects.toBeInstanceOf(ForbiddenError)
      expect((await findById(admin, id))!.status).toBe('FAILED')
    })
  })
})
