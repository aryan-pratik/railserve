import { afterAll, describe, expect, it, beforeAll } from 'vitest'
import { disconnectDb } from '../src/lib/db'
import { transitionOrder, assignAgents, adminOverrideStatus } from '../src/lib/repo/transitionOrder'
import { findById } from '../src/lib/repo/orderRepo'
import { ConflictError, ForbiddenError, type AuthContext } from '../src/lib/authContext'
import { ctxFor, makeOrder, makeRestaurant, makeUser, resetDb } from './fixtures'
import { allowedNextStatuses } from '../src/lib/orderStatus'

describe('transitionOrder', () => {
  let admin: AuthContext
  let manager: AuthContext
  let agent: AuthContext
  let restaurantId: import('mongoose').Types.ObjectId
  let agentId: import('mongoose').Types.ObjectId

  beforeAll(async () => {
    await resetDb()
    const r = await makeRestaurant('HOTEL GANGA GALAXY', 'CNB')
    restaurantId = r._id
    admin = ctxFor(await makeUser('ADMIN', '9000000001'))
    manager = ctxFor(await makeUser('STORE_MANAGER', '9000000002', r._id))
    const a = await makeUser('DELIVERY_AGENT', '9000000004', r._id)
    agentId = a._id
    agent = ctxFor(a)
  })

  afterAll(async () => {
    await disconnectDb()
  })

  async function newOrder(overrides: Record<string, unknown> = {}) {
    const o = await makeOrder({ restaurantId, delivery: { agentIds: [agentId] }, ...overrides })
    return String(o._id)
  }

  it('walks the full retail happy path and records every event', async () => {
    const id = await newOrder()
    await transitionOrder({ ctx: manager, orderId: id, to: 'ACCEPTED' })
    await transitionOrder({ ctx: manager, orderId: id, to: 'KOT_PRINTED' })
    await transitionOrder({ ctx: manager, orderId: id, to: 'PREPARED' })
    await transitionOrder({ ctx: agent, orderId: id, to: 'DISPATCHED' })
    const final = await transitionOrder({
      ctx: agent,
      orderId: id,
      to: 'DELIVERED',
      apply: { proofType: 'SIGNATURE', proofValue: 'Neelesh Soni', amountCollectedPaise: 12000 },
    })

    expect(final.status).toBe('DELIVERED')
    expect(final.events.map((e) => e.toStatus)).toEqual([
      'RECEIVED', 'ACCEPTED', 'KOT_PRINTED', 'PREPARED', 'DISPATCHED', 'DELIVERED',
    ])
    const acted = final.events.filter((e) => e.fromStatus !== null)
    expect(acted.every((e) => e.userId)).toBe(true)
    expect(final.delivery.dispatchedAt).toBeInstanceOf(Date)
    expect(final.delivery.deliveredAt).toBeInstanceOf(Date)
    expect(final.delivery.proofValue).toBe('Neelesh Soni')
    expect(final.delivery.amountCollectedPaise).toBe(12000)
  })

  it('rejects an edge that is not on the allow-list', async () => {
    const id = await newOrder()
    await expect(
      transitionOrder({ ctx: manager, orderId: id, to: 'DELIVERED' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('rejects a legal edge attempted by the wrong role', async () => {
    const id = await newOrder()
    await transitionOrder({ ctx: manager, orderId: id, to: 'ACCEPTED' })
    await transitionOrder({ ctx: manager, orderId: id, to: 'KOT_PRINTED' })
    await transitionOrder({ ctx: manager, orderId: id, to: 'PREPARED' })
    // PREPARED -> DISPATCHED is legal for a manager only when they name the
    // rider who took it; bare, it is refused.
    await expect(
      transitionOrder({ ctx: manager, orderId: id, to: 'DISPATCHED' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    // An agent needs no such argument — they are the carrier.
    const done = await transitionOrder({ ctx: agent, orderId: id, to: 'DISPATCHED' })
    expect(done.delivery.agentIds.map(String)).toEqual([String(agentId)])
  })

  it('refuses to leave a terminal status', async () => {
    const id = await newOrder()
    await transitionOrder({ ctx: admin, orderId: id, to: 'CANCELLED' })
    await expect(
      transitionOrder({ ctx: manager, orderId: id, to: 'ACCEPTED' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('enforces the completeness guard on QUOTED -> RECEIVED', async () => {
    const id = await newOrder({
      orderType: 'BULK',
      status: 'ENQUIRY',
      restaurantId: null,
      amountPaise: null,
      paymentMode: null,
      contactPhone: null,
      pax: 75,
    })
    await transitionOrder({ ctx: admin, orderId: id, to: 'QUOTED' })

    await expect(
      transitionOrder({ ctx: admin, orderId: id, to: 'RECEIVED' }),
    ).rejects.toThrow(/missing required field/i)
  })

  it('allows QUOTED -> RECEIVED once every required field is present', async () => {
    const id = await newOrder({
      orderType: 'BULK',
      status: 'ENQUIRY',
      pax: 75,
      readyBy: new Date('2026-09-03T13:00:00Z'),
    })
    await transitionOrder({ ctx: admin, orderId: id, to: 'QUOTED' })
    const confirmed = await transitionOrder({ ctx: admin, orderId: id, to: 'RECEIVED' })
    expect(confirmed.status).toBe('RECEIVED')
  })

  it('lets exactly one of two concurrent identical transitions win', async () => {
    const id = await newOrder()
    await transitionOrder({ ctx: manager, orderId: id, to: 'ACCEPTED' })
    await transitionOrder({ ctx: manager, orderId: id, to: 'KOT_PRINTED' })

    // Two managers hit "Mark Prepared" at the same moment.
    const results = await Promise.allSettled([
      transitionOrder({ ctx: manager, orderId: id, to: 'PREPARED' }),
      transitionOrder({ ctx: manager, orderId: id, to: 'PREPARED' }),
    ])

    const ok = results.filter((r) => r.status === 'fulfilled')
    const failed = results.filter((r) => r.status === 'rejected')
    expect(ok).toHaveLength(1)
    expect(failed).toHaveLength(1)

    // The loser must be a conflict, not a silent success.
    const reason = (failed[0] as PromiseRejectedResult).reason
    expect(reason).toBeInstanceOf(ConflictError)

    // And exactly one event was recorded, not two.
    const after = await findById(admin, id)
    expect(after!.events.filter((e) => e.toStatus === 'PREPARED')).toHaveLength(1)
  })

  it('assigns agents and audits it onto the event log', async () => {
    const id = await newOrder({ delivery: { agentIds: [] } })
    const updated = await assignAgents({ ctx: admin, orderId: id, agentIds: [String(agentId)] })
    expect(updated.delivery.agentIds.map(String)).toEqual([String(agentId)])
    expect(updated.delivery.assignedAt).toBeInstanceOf(Date)
    const evt = updated.events.at(-1)!
    expect(evt.meta).toMatchObject({ action: 'ASSIGN_AGENTS' })
  })

  it('only an admin may assign agents', async () => {
    const id = await newOrder()
    await expect(
      assignAgents({ ctx: manager, orderId: id, agentIds: [String(agentId)] }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('exposes role-correct next actions for the UI', () => {
    expect(allowedNextStatuses('RECEIVED', 'STORE_MANAGER')).toEqual(['ACCEPTED'])
    expect(allowedNextStatuses('RECEIVED', 'ADMIN')).toEqual(['ACCEPTED', 'CANCELLED'])
    expect(allowedNextStatuses('PREPARED', 'DELIVERY_AGENT')).toEqual(['DISPATCHED'])
    expect(allowedNextStatuses('DELIVERED', 'ADMIN')).toEqual([])
  })

  describe('adminOverrideStatus', () => {
    it('allows a jump the TRANSITIONS allow-list would reject', async () => {
      const id = await newOrder()
      const updated = await adminOverrideStatus({ ctx: admin, orderId: id, to: 'REFUND_PENDING' })
      expect(updated.status).toBe('REFUND_PENDING')
    })

    it('records an audit event tagged as an admin override', async () => {
      const id = await newOrder()
      const updated = await adminOverrideStatus({
        ctx: admin,
        orderId: id,
        to: 'VIP',
        meta: { via: 'admin-orders-list' },
      })
      const evt = updated.events.at(-1)!
      expect(evt.fromStatus).toBe('RECEIVED')
      expect(evt.toStatus).toBe('VIP')
      expect(evt.meta).toMatchObject({ via: 'admin-override' })
    })

    it('rejects a non-admin caller', async () => {
      const id = await newOrder()
      await expect(
        adminOverrideStatus({ ctx: manager, orderId: id, to: 'VIP' }),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('refuses a no-op set to the same status', async () => {
      const id = await newOrder()
      await expect(
        adminOverrideStatus({ ctx: admin, orderId: id, to: 'RECEIVED' }),
      ).rejects.toBeInstanceOf(ConflictError)
    })

    it('does not disturb the guided pipeline — a later normal transition still works', async () => {
      const id = await newOrder()
      await adminOverrideStatus({ ctx: admin, orderId: id, to: 'RECEIVED_BUT_FLAGGED' })
      // Nothing stops an admin from setting it straight back to a real status.
      const back = await adminOverrideStatus({ ctx: admin, orderId: id, to: 'RECEIVED' })
      expect(back.status).toBe('RECEIVED')
      await transitionOrder({ ctx: manager, orderId: id, to: 'ACCEPTED' })
      const after = await findById(admin, id)
      expect(after!.status).toBe('ACCEPTED')
    })
  })
})
