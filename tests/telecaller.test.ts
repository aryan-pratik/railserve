import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { disconnectDb } from '../src/lib/db'
import { findById, recentCancellations } from '../src/lib/repo/orderRepo'
import { clearRefund, flagRatingOrder, recordRefund, transitionOrder } from '../src/lib/repo/transitionOrder'
import { createManualOrder } from '../src/lib/repo/createOrder'
import { latestBalance, setPaymentRemark } from '../src/lib/repo/paymentRepo'
import { dispatchRun } from '../src/lib/repo/runRepo'
import { ForbiddenError, NotFoundError, type AuthContext } from '../src/lib/authContext'
import { allowedNextStatuses, canFlagRatingOrder } from '../src/lib/orderStatus'
import { assignRider, ctxFor, makeOrder, makeRestaurant, makeUser, resetDb } from './fixtures'

/**
 * The telecaller: cancelling, four states, one outlet set.
 *
 * The role exists because a cancellation used to travel by WhatsApp and got
 * missed — the kitchen cooked food nobody wanted and a rider carried it to the
 * platform. These tests pin the two halves of the fix that are easy to break
 * later: that a telecaller can cancel exactly where they should be able to,
 * and that they can reach nothing else.
 */
describe('telecaller', () => {
  let telecaller: AuthContext
  let otherTelecaller: AuthContext
  let manager: AuthContext
  let agent: AuthContext
  let ganga: import('mongoose').Types.ObjectId
  let annapurna: import('mongoose').Types.ObjectId
  let agentId: import('mongoose').Types.ObjectId

  beforeAll(async () => {
    await resetDb()
    const g = await makeRestaurant('HOTEL GANGA GALAXY', 'CNB')
    const a = await makeRestaurant('SHREE ANNAPURNA', 'PRYJ')
    ganga = g._id
    annapurna = a._id

    telecaller = ctxFor(await makeUser('TELECALLER', '9000000010', ganga))
    otherTelecaller = ctxFor(await makeUser('TELECALLER', '9000000011', annapurna))
    manager = ctxFor(await makeUser('STORE_MANAGER', '9000000012', ganga))
    const rider = await makeUser('DELIVERY_AGENT', '9000000013', ganga)
    agentId = rider._id
    agent = ctxFor(rider)
  })

  afterAll(async () => {
    await disconnectDb()
  })

  async function newOrder(overrides: Record<string, unknown> = {}) {
    const o = await makeOrder({ restaurantId: ganga, stationCode: 'CNB', ...overrides })
    return String(o._id)
  }

  /** Walks an order up to `target` using whichever role owns each edge. */
  async function advanceTo(orderId: string, target: 'ACCEPTED' | 'KOT_PRINTED' | 'PREPARED') {
    const path = ['ACCEPTED', 'KOT_PRINTED', 'PREPARED'] as const
    for (const status of path) {
      await transitionOrder({ ctx: manager, orderId, to: status })
      if (status === target) return
    }
  }

  describe('cancelling', () => {
    it('cancels from RECEIVED', async () => {
      const id = await newOrder()
      const out = await transitionOrder({
        ctx: telecaller,
        orderId: id,
        to: 'CANCELLED',
        meta: { via: 'telecaller-call', reason: 'Passenger cancelled on the call' },
      })
      expect(out.status).toBe('CANCELLED')
      const last = out.events.at(-1)!
      expect(last.fromStatus).toBe('RECEIVED')
      expect(String(last.userId)).toBe(String(telecaller.userId))
      expect(last.meta).toMatchObject({ reason: 'Passenger cancelled on the call' })
    })

    it('cancels from ACCEPTED, KOT_PRINTED and PREPARED', async () => {
      for (const at of ['ACCEPTED', 'KOT_PRINTED', 'PREPARED'] as const) {
        const id = await newOrder()
        await advanceTo(id, at)
        const out = await transitionOrder({
          ctx: telecaller,
          orderId: id,
          to: 'CANCELLED',
          meta: { reason: 'Passenger cancelled on the call' },
        })
        expect(out.status).toBe('CANCELLED')
        expect(out.events.at(-1)!.fromStatus).toBe(at)
      }
    })

    it('cancels while a rider is carrying it', async () => {
      const id = await newOrder()
      await advanceTo(id, 'PREPARED')
      await assignRider(id, agentId)
      await transitionOrder({ ctx: agent, orderId: id, to: 'DISPATCHED' })

      const out = await transitionOrder({
        ctx: telecaller,
        orderId: id,
        to: 'CANCELLED',
        meta: { via: 'telecaller-call', reason: 'Train diverted' },
      })
      expect(out.status).toBe('CANCELLED')
    })

    it('exactly these outcomes are open to a telecaller, per status', () => {
      // In the kitchen: cancel, or "not delivered" when the train left first.
      for (const from of ['RECEIVED', 'ACCEPTED', 'KOT_PRINTED'] as const) {
        expect(allowedNextStatuses(from, 'TELECALLER').sort()).toEqual(['CANCELLED', 'FAILED'])
      }
      // Once the food is ready, the passenger can also say it arrived.
      for (const from of ['PREPARED', 'DISPATCHED'] as const) {
        expect(allowedNextStatuses(from, 'TELECALLER').sort()).toEqual(['CANCELLED', 'DELIVERED', 'FAILED'])
      }
      // Group enquiries belong to an admin.
      for (const from of ['ENQUIRY', 'QUOTED'] as const) {
        expect(allowedNextStatuses(from, 'TELECALLER')).toEqual([])
      }
    })

    it('no outcome is open once an order is closed', async () => {
      const id = await newOrder()
      await advanceTo(id, 'PREPARED')
      await assignRider(id, agentId)
      await transitionOrder({ ctx: agent, orderId: id, to: 'DISPATCHED' })
      await transitionOrder({ ctx: agent, orderId: id, to: 'DELIVERED' })
      await expect(transitionOrder({ ctx: telecaller, orderId: id, to: 'FAILED' })).rejects.toThrow(ForbiddenError)
    })
  })

  describe('delivered and not delivered', () => {
    it('marks a dispatched order delivered, keeping the rider on record', async () => {
      const id = await newOrder()
      await advanceTo(id, 'PREPARED')
      await assignRider(id, agentId)
      await transitionOrder({ ctx: agent, orderId: id, to: 'DISPATCHED' })

      const out = await transitionOrder({ ctx: telecaller, orderId: id, to: 'DELIVERED' })
      expect(out.status).toBe('DELIVERED')
      expect(out.delivery.deliveredAt).toBeInstanceOf(Date)
      // The telecaller is not the carrier: the rider stays, and only the rider.
      expect(out.delivery.agentIds.map(String)).toEqual([String(agentId)])
    })

    it('marks a prepared order delivered without naming a rider', async () => {
      const id = await newOrder()
      await advanceTo(id, 'PREPARED')
      const out = await transitionOrder({ ctx: telecaller, orderId: id, to: 'DELIVERED' })
      expect(out.status).toBe('DELIVERED')
      expect(out.delivery.agentIds).toEqual([])
    })

    it('marks not delivered with the reason in failureReason', async () => {
      const id = await newOrder()
      await advanceTo(id, 'PREPARED')
      await assignRider(id, agentId)
      await transitionOrder({ ctx: agent, orderId: id, to: 'DISPATCHED' })

      const out = await transitionOrder({
        ctx: telecaller,
        orderId: id,
        to: 'FAILED',
        meta: { via: 'telecaller-call', reason: 'Passenger not at seat' },
        apply: { failureReason: 'Passenger not at seat' },
      })
      expect(out.status).toBe('FAILED')
      expect(out.delivery.failureReason).toBe('Passenger not at seat')
    })

    it('cannot mark delivered before the food is ready', async () => {
      const id = await newOrder()
      await advanceTo(id, 'KOT_PRINTED')
      await expect(
        transitionOrder({ ctx: telecaller, orderId: id, to: 'DELIVERED' }),
      ).rejects.toThrow(ForbiddenError)
    })

    it('a store manager still has to name the rider', async () => {
      const id = await newOrder()
      await advanceTo(id, 'PREPARED')
      await expect(
        transitionOrder({ ctx: manager, orderId: id, to: 'DISPATCHED' }),
      ).rejects.toThrow(ForbiddenError)
    })
  })

  describe('not delivered, with a reason', () => {
    it('food that missed its train in the kitchen is not delivered, reason kept', async () => {
      const id = await newOrder()
      await advanceTo(id, 'KOT_PRINTED')
      const out = await transitionOrder({
        ctx: telecaller,
        orderId: id,
        to: 'FAILED',
        meta: { via: 'telecaller-call', reason: 'Missed the train' },
        apply: { failureReason: 'MISSED_TRAIN' },
      })
      expect(out.status).toBe('FAILED')
      expect(out.delivery?.failureReason).toBe('MISSED_TRAIN')
    })
  })

  describe('refunds are recorded on the order, not as a status', () => {
    it('records a partial refund and keeps the order delivered', async () => {
      const id = await newOrder()
      await advanceTo(id, 'PREPARED')
      await assignRider(id, agentId)
      await transitionOrder({ ctx: agent, orderId: id, to: 'DISPATCHED' })
      await transitionOrder({ ctx: agent, orderId: id, to: 'DELIVERED' })

      const out = await recordRefund({ ctx: telecaller, orderId: id, amountPaise: 8000, reason: 'WRONG_OR_MISSING_ITEM', payer: 'AGGREGATOR', note: 'Raita missing' })
      expect(out.status).toBe('DELIVERED')
      expect(out.refund).toMatchObject({ amountPaise: 8000, reason: 'WRONG_OR_MISSING_ITEM', payer: 'AGGREGATOR', note: 'Raita missing' })
      expect(out.events.at(-1)!.meta).toMatchObject({ via: 'refund', amountPaise: 8000 })

      await clearRefund({ ctx: telecaller, orderId: id })
      expect((await findById(telecaller, id))!.refund).toBeNull()
    })

    it('refuses more than the order total, and refuses a kitchen or rider', async () => {
      const id = await newOrder()
      await expect(recordRefund({ ctx: telecaller, orderId: id, amountPaise: 10_000_000, reason: 'LATE', payer: null })).rejects.toThrow(/more than the order total/)
      await expect(recordRefund({ ctx: manager, orderId: id, amountPaise: 100, reason: 'LATE', payer: null })).rejects.toThrow(ForbiddenError)
      await expect(recordRefund({ ctx: agent, orderId: id, amountPaise: 100, reason: 'LATE', payer: null })).rejects.toThrow(ForbiddenError)
    })
  })

  describe('rating order is a tag, not a status', () => {
    it('is offered to the call desk and admins only', () => {
      expect(canFlagRatingOrder('TELECALLER')).toBe(true)
      expect(canFlagRatingOrder('ADMIN')).toBe(true)
      expect(canFlagRatingOrder('STORE_MANAGER')).toBe(false)
      expect(canFlagRatingOrder('DELIVERY_AGENT')).toBe(false)
    })

    it('tags an order in any status, which keeps its status, and can be taken back', async () => {
      const id = await newOrder()
      await advanceTo(id, 'PREPARED')
      await assignRider(id, agentId)
      await transitionOrder({ ctx: agent, orderId: id, to: 'DISPATCHED' })
      await transitionOrder({ ctx: agent, orderId: id, to: 'DELIVERED' })

      const out = await flagRatingOrder({ ctx: telecaller, orderId: id })
      expect(out.status).toBe('DELIVERED')
      expect(out.ratingOrder).toBe(true)
      expect(out.events.at(-1)!.meta).toMatchObject({ via: 'rating-flag' })

      const back = await flagRatingOrder({ ctx: telecaller, orderId: id, on: false })
      expect(back.ratingOrder).toBe(false)
    })

    it('refuses a kitchen or rider', async () => {
      const id = await newOrder()
      await expect(flagRatingOrder({ ctx: manager, orderId: id })).rejects.toThrow(ForbiddenError)
      await expect(flagRatingOrder({ ctx: agent, orderId: id })).rejects.toThrow(ForbiddenError)
    })

    it('is outlet-scoped like every other telecaller action', async () => {
      const id = await newOrder()
      await expect(flagRatingOrder({ ctx: otherTelecaller, orderId: id })).rejects.toThrow(NotFoundError)
    })
  })

  describe('everything else is refused', () => {
    it('cannot move an order forward through the kitchen', async () => {
      const id = await newOrder()
      await expect(
        transitionOrder({ ctx: telecaller, orderId: id, to: 'ACCEPTED' }),
      ).rejects.toThrow(ForbiddenError)

      await advanceTo(id, 'PREPARED')
      await expect(
        transitionOrder({ ctx: telecaller, orderId: id, to: 'DISPATCHED' }),
      ).rejects.toThrow(ForbiddenError)
    })

    it('cannot create an order', async () => {
      await expect(
        createManualOrder(telecaller, {
          orderType: 'RETAIL',
          restaurantId: String(ganga),
          serviceDate: '2026-08-27',
          items: [{ name: 'Veg Thali', qty: 1 }],
        } as unknown as Parameters<typeof createManualOrder>[1]),
      ).rejects.toThrow(ForbiddenError)
    })

    it('cannot see the bank balance', async () => {
      await expect(latestBalance(telecaller)).rejects.toThrow(ForbiddenError)
    })

    it('cannot edit a payment remark', async () => {
      await expect(setPaymentRemark(telecaller, 'anything', 'a remark')).rejects.toThrow(
        ForbiddenError,
      )
    })

    it('cannot dispatch a run', async () => {
      await expect(dispatchRun(telecaller, 'anything')).rejects.toThrow(ForbiddenError)
    })
  })

  describe('outlet isolation', () => {
    it('gets nothing for another outlet’s order by id', async () => {
      const id = await newOrder()
      expect(await findById(otherTelecaller, id)).toBeNull()
    })

    it('cancelling another outlet’s order is a 404, not a refusal', async () => {
      const id = await newOrder()
      // A ForbiddenError here would itself confirm the order exists.
      await expect(
        transitionOrder({ ctx: otherTelecaller, orderId: id, to: 'CANCELLED' }),
      ).rejects.toThrow(NotFoundError)
    })
  })

  describe('the alert feed', () => {
    it('reports a fresh cancellation with its reason and who made it, in scope only', async () => {
      const serviceDate = '2026-09-19'
      const mine = await newOrder({ serviceDate })
      await assignRider(mine, agentId)
      const theirs = String(
        (await makeOrder({ restaurantId: annapurna, stationCode: 'PRYJ', serviceDate }))._id,
      )

      await transitionOrder({
        ctx: telecaller,
        orderId: mine,
        to: 'CANCELLED',
        meta: { reason: 'Train cancelled or diverted' },
      })
      await transitionOrder({
        ctx: otherTelecaller,
        orderId: theirs,
        to: 'CANCELLED',
        meta: { reason: 'Not this outlet' },
      })

      const since = new Date(Date.now() - 60_000)
      const forManager = await recentCancellations(manager, { serviceDate, since })
      expect(forManager.map((c) => c.id)).toEqual([mine])
      expect(forManager[0].reason).toBe('Train cancelled or diverted')
      expect(forManager[0].by).toBe(`TELECALLER ${'9000000010'}`)

      // The rider it is assigned to is told too — they are the last person
      // who can stop the food leaving the counter.
      expect((await recentCancellations(agent, { serviceDate, since })).map((c) => c.id)).toEqual([
        mine,
      ])
    })

    it('says nothing about a cancellation older than the window', async () => {
      const serviceDate = '2026-09-18'
      const id = await newOrder({ serviceDate })
      await transitionOrder({ ctx: telecaller, orderId: id, to: 'CANCELLED' })

      const future = new Date(Date.now() + 60_000)
      expect(await recentCancellations(manager, { serviceDate, since: future })).toEqual([])
    })
  })

  it('records the rider, not the telecaller, when a manager hands food over', async () => {
    // Guards the one place a non-rider may reach DISPATCHED: it must still
    // name a real rider, and a telecaller is not one.
    const id = await newOrder()
    await advanceTo(id, 'PREPARED')
    const out = await transitionOrder({
      ctx: manager,
      orderId: id,
      to: 'DISPATCHED',
      handedTo: agentId,
    })
    expect(out.delivery.agentIds.map(String)).toEqual([String(agentId)])
  })
})
