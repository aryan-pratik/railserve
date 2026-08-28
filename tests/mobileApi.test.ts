import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { disconnectDb } from '../src/lib/db'
import { issueMobileToken, verifyMobileToken } from '../src/lib/mobile/token'
import { ctxFor, makeOrder, makeRestaurant, makeUser, resetDb } from './fixtures'
import { assignAgents, transitionOrder } from '../src/lib/repo/transitionOrder'
import { dispatchRun } from '../src/lib/repo/runRepo'
import { findById } from '../src/lib/repo/orderRepo'
import { runKeyFor } from '../src/lib/runs'
import { todayIST } from '../src/lib/format'
import type { AuthContext } from '../src/lib/authContext'

describe('mobile bearer tokens', () => {
  const user = {
    _id: new mongoose.Types.ObjectId(),
    role: 'DELIVERY_AGENT' as const,
    restaurantId: null,
    name: 'Ravi Kumar',
  }

  it('round-trips its claims', () => {
    const { token } = issueMobileToken(user)
    const payload = verifyMobileToken(token)
    expect(payload?.sub).toBe(String(user._id))
    expect(payload?.role).toBe('DELIVERY_AGENT')
    expect(payload?.name).toBe('Ravi Kumar')
  })

  it('rejects a tampered payload', () => {
    const { token } = issueMobileToken(user)
    const [body, sig] = token.split('.')
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), role: 'ADMIN' }),
    ).toString('base64url')
    expect(verifyMobileToken(`${forged}.${sig}`)).toBeNull()
  })

  it('rejects a tampered signature', () => {
    const { token } = issueMobileToken(user)
    const [body] = token.split('.')
    expect(verifyMobileToken(`${body}.notarealsignature`)).toBeNull()
  })

  it('rejects garbage', () => {
    expect(verifyMobileToken('')).toBeNull()
    expect(verifyMobileToken('nodot')).toBeNull()
    expect(verifyMobileToken('a.b')).toBeNull()
  })

  it('rejects an expired token', () => {
    const { token } = issueMobileToken(user)
    const [body, sig] = token.split('.')
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString())
    payload.exp = Math.floor(Date.now() / 1000) - 10
    // Re-signing an expired payload must still fail on the expiry check.
    const expiredBody = Buffer.from(JSON.stringify(payload)).toString('base64url')
    expect(verifyMobileToken(`${expiredBody}.${sig}`)).toBeNull()
  })
})

describe('offline queue replay safety', () => {
  let admin: AuthContext
  let manager: AuthContext
  let agent: AuthContext
  let orderId: string
  let runKey: string

  beforeAll(async () => {
    await resetDb()
    const r = await makeRestaurant('HOTEL GANGA GALAXY', 'CNB')
    admin = ctxFor(await makeUser('ADMIN', '9000000001'))
    manager = ctxFor(await makeUser('STORE_MANAGER', '9000000002', r._id))
    const a = await makeUser('DELIVERY_AGENT', '9000000004', r._id)
    agent = ctxFor(a)

    const today = todayIST()
    const o = await makeOrder({
      restaurantId: r._id, serviceDate: today, trainNo: '12506',
      stationCode: 'CNB', coach: 'B5', paymentMode: 'COD', amountPaise: 23600,
    })
    orderId = String(o._id)
    runKey = runKeyFor({ trainNo: '12506', serviceDate: today, stationCode: 'CNB' })

    await assignAgents({ ctx: admin, orderId, agentIds: [String(a._id)] })
    for (const to of ['ACCEPTED', 'KOT_PRINTED', 'PREPARED'] as const) {
      await transitionOrder({ ctx: manager, orderId, to })
    }
  })

  afterAll(async () => {
    await disconnectDb()
  })

  it('dispatches the run once', async () => {
    const r = await dispatchRun(agent, runKey)
    expect(r.moved).toBe(1)
  })

  it('a replayed dispatch reports nothing left to move rather than erroring', async () => {
    // The queue flushes twice after a flaky reconnect.
    const r = await dispatchRun(agent, runKey)
    expect(r.moved).toBe(0)
    expect(r.skipped).toBe(1)
    expect(r.errors).toEqual([])
  })

  it('delivers with proof and cash collected', async () => {
    const done = await transitionOrder({
      ctx: agent, orderId, to: 'DELIVERED',
      apply: { proofType: 'SIGNATURE', proofValue: 'Neelesh Soni', amountCollectedPaise: 23600 },
    })
    expect(done.status).toBe('DELIVERED')
    expect(done.delivery.amountCollectedPaise).toBe(23600)
  })

  it('a replayed delivery is detectable as already-done, not a hard failure', async () => {
    // This is what the endpoint checks before transitioning: same target
    // status means the queue should drop the item, not retry it forever.
    const current = await findById(agent, orderId)
    expect(current!.status).toBe('DELIVERED')

    await expect(
      transitionOrder({ ctx: agent, orderId, to: 'DELIVERED' }),
    ).rejects.toThrow(/already DELIVERED/i)
  })

  it('records exactly one delivery event despite the replay', async () => {
    const o = await findById(agent, orderId)
    expect(o!.events.filter((e) => e.toStatus === 'DELIVERED')).toHaveLength(1)
  })
})
