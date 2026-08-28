import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { disconnectDb } from '../src/lib/db'
import { findById, findMany } from '../src/lib/repo/orderRepo'
import { transitionOrder, assignAgents } from '../src/lib/repo/transitionOrder'
import { dispatchRun, findRun, findRuns } from '../src/lib/repo/runRepo'
import { ForbiddenError, type AuthContext } from '../src/lib/authContext'
import { runKeyFor } from '../src/lib/runs'
import { ctxFor, makeOrder, makeRestaurant, makeUser, resetDb } from './fixtures'

const DATE = '2026-08-27'

/**
 * Riders are not assigned work; they take what is ready at their own kitchen,
 * and the system records who actually handled it. These tests pin both halves:
 * a rider sees their outlet and nothing else, and delivering writes them onto
 * the order.
 */
describe('delivery: outlet scope, dispatch, proof', () => {
  let admin: AuthContext
  let manager: AuthContext
  let riderA: AuthContext
  let riderB: AuthContext
  let riderAId: import('mongoose').Types.ObjectId
  let riderBId: import('mongoose').Types.ObjectId
  let ganga: import('mongoose').Types.ObjectId
  let runKey: string

  beforeAll(async () => {
    await resetDb()
    const g = await makeRestaurant('HOTEL GANGA GALAXY', 'CNB')
    const other = await makeRestaurant('SHREE ANNAPURNA', 'PRYJ')
    ganga = g._id

    admin = ctxFor(await makeUser('ADMIN', '9000000001'))
    manager = ctxFor(await makeUser('STORE_MANAGER', '9000000002', g._id))
    // Both riders work the same kitchen — that is the normal case now.
    const a = await makeUser('DELIVERY_AGENT', '9000000004', g._id)
    const b = await makeUser('DELIVERY_AGENT', '9000000005', g._id)
    // A rider at a different station, to prove isolation still holds.
    const outsider = await makeUser('DELIVERY_AGENT', '9000000007', other._id)
    riderAId = a._id
    riderBId = b._id
    riderA = ctxFor(a)
    riderB = ctxFor(b)
    outsiderCtx = ctxFor(outsider)

    // Three orders on one train, deliberately out of coach order.
    for (const coach of ['S9', 'B2', 'A1']) {
      await makeOrder({
        restaurantId: ganga, serviceDate: DATE, trainNo: '12506', trainName: 'NORTH EAST EXP',
        stationCode: 'CNB', coach, berth: '11', rawSeat: `${coach}-11`,
        scheduledArrival: new Date('2026-08-27T07:55:00Z'),
      })
    }
    // A second train at the same kitchen, so grouping has something to separate.
    await makeOrder({
      restaurantId: ganga, serviceDate: DATE, trainNo: '12312', trainName: 'KALKA MAIL',
      stationCode: 'CNB', coach: 'B1', scheduledArrival: new Date('2026-08-27T04:10:00Z'),
    })
    // An order at the other station entirely.
    await makeOrder({
      restaurantId: other._id, serviceDate: DATE, trainNo: '12801', stationCode: 'PRYJ',
      coach: 'A2', scheduledArrival: new Date('2026-08-27T06:00:00Z'),
    })

    runKey = runKeyFor({ trainNo: '12506', serviceDate: DATE, stationCode: 'CNB' })
  })

  let outsiderCtx: AuthContext

  afterAll(async () => {
    await disconnectDb()
  })

  it('a rider sees every run at their own kitchen without being assigned', async () => {
    const runs = await findRuns(riderA, DATE)
    expect(runs.map((r) => r.trainNo).sort()).toEqual(['12312', '12506'])
  })

  it('both riders at a kitchen see the same work', async () => {
    const a = (await findRuns(riderA, DATE)).map((r) => r.key).sort()
    const b = (await findRuns(riderB, DATE)).map((r) => r.key).sort()
    expect(a).toEqual(b)
  })

  it('a rider at another station sees none of it', async () => {
    const runs = await findRuns(outsiderCtx, DATE)
    expect(runs.map((r) => r.trainNo)).toEqual(['12801'])
    const gangaOrder = (await findMany(admin, { restaurantId: ganga }))[0]
    expect(await findById(outsiderCtx, String(gangaOrder._id))).toBeNull()
  })

  it('a rider holding no outlet sees nothing, rather than everything', async () => {
    const orphan = ctxFor(await makeUser('DELIVERY_AGENT', '9000000008'))
    expect(await findMany(orphan)).toEqual([])
    expect(await findRuns(orphan, DATE)).toHaveLength(0)
  })

  it('sorts the run by coach so the rider walks one direction', async () => {
    const run = await findRun(riderA, runKey)
    expect(run!.orders.map((o) => o.coach)).toEqual(['A1', 'B2', 'S9'])
  })

  it('refuses to dispatch when nothing is prepared', async () => {
    const res = await dispatchRun(riderA, runKey)
    expect(res.moved).toBe(0)
    expect(res.skipped).toBe(3)
  })

  it('only a delivery agent may dispatch a run', async () => {
    await expect(dispatchRun(admin, runKey)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(dispatchRun(manager, runKey)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('dispatches what is ready and leaves the rest for the kitchen', async () => {
    const run = await findRun(riderA, runKey)
    // Two of three make it through the kitchen.
    for (const o of run!.orders.slice(0, 2)) {
      for (const to of ['ACCEPTED', 'KOT_PRINTED', 'PREPARED'] as const) {
        await transitionOrder({ ctx: manager, orderId: String(o._id), to })
      }
    }

    const res = await dispatchRun(riderA, runKey)
    expect(res.moved).toBe(2)
    expect(res.skipped).toBe(1)
    expect(res.errors).toEqual([])
  })

  it('records which rider dispatched, without anyone assigning them', async () => {
    const run = await findRun(riderA, runKey)
    const dispatched = run!.orders.filter((o) => o.status === 'DISPATCHED')
    expect(dispatched).toHaveLength(2)
    for (const o of dispatched) {
      expect(o.delivery.agentIds.map(String)).toContain(String(riderAId))
    }
  })

  it('delivers with photo proof and records the cash collected', async () => {
    const run = await findRun(riderA, runKey)
    const dispatched = run!.orders.find((o) => o.status === 'DISPATCHED')!

    const done = await transitionOrder({
      ctx: riderA, orderId: String(dispatched._id), to: 'DELIVERED',
      apply: {
        proofType: 'PHOTO',
        proofValue: 'proof/2026-08-27/abc123.jpg',
        amountCollectedPaise: 12000,
      },
    })

    expect(done.status).toBe('DELIVERED')
    expect(done.delivery.proofType).toBe('PHOTO')
    expect(done.delivery.proofValue).toBe('proof/2026-08-27/abc123.jpg')
    expect(done.delivery.amountCollectedPaise).toBe(12000)
    expect(done.delivery.deliveredAt).toBeInstanceOf(Date)
    expect(done.delivery.dispatchedAt).toBeInstanceOf(Date)
    expect(done.delivery.agentIds.map(String)).toContain(String(riderAId))
  })

  it('delivering without a photo is allowed — proof is optional', async () => {
    const run = await findRun(riderB, runKey)
    const dispatched = run!.orders.find((o) => o.status === 'DISPATCHED')!

    const done = await transitionOrder({
      ctx: riderB, orderId: String(dispatched._id), to: 'DELIVERED',
      apply: { proofType: 'SIGNATURE', proofValue: 'Neelesh Soni' },
    })

    expect(done.status).toBe('DELIVERED')
    // riderB delivered it, so riderB is on it — even though riderA dispatched.
    expect(done.delivery.agentIds.map(String)).toContain(String(riderBId))
    expect(done.delivery.agentIds.map(String)).toContain(String(riderAId))
  })

  it('records a failure with its reason and the rider who reported it', async () => {
    // The third order never went through the kitchen; walk it all the way so
    // there is something dispatched left to fail.
    const run = await findRun(riderA, runKey)
    const remaining = run!.orders.find((o) => o.status === 'RECEIVED')!
    for (const to of ['ACCEPTED', 'KOT_PRINTED', 'PREPARED'] as const) {
      await transitionOrder({ ctx: manager, orderId: String(remaining._id), to })
    }
    await transitionOrder({ ctx: riderA, orderId: String(remaining._id), to: 'DISPATCHED' })

    const dispatched = (await findRun(riderA, runKey))!.orders.find(
      (o) => o.status === 'DISPATCHED',
    )!

    const failed = await transitionOrder({
      ctx: riderA, orderId: String(dispatched._id), to: 'FAILED',
      apply: { failureReason: 'Passenger not at seat, train did not halt' },
    })

    expect(failed.status).toBe('FAILED')
    expect(failed.delivery.failureReason).toContain('not at seat')
    expect(failed.delivery.agentIds.map(String)).toContain(String(riderAId))
  })

  it('an admin can still correct the recorded rider on a single order', async () => {
    const delivered = (await findMany(admin, { status: 'DELIVERED' }))[0]
    const fixed = await assignAgents({
      ctx: admin, orderId: String(delivered._id), agentIds: [String(riderBId)],
    })
    expect(fixed.delivery.agentIds.map(String)).toEqual([String(riderBId)])
  })

  it('leaves a complete audit trail from creation to delivery', async () => {
    const delivered = (await findMany(admin, { status: 'DELIVERED' }))[0]

    const trail = delivered.events
      .filter((e) => e.fromStatus !== e.toStatus)
      .map((e) => e.toStatus)
    expect(trail).toEqual([
      'RECEIVED', 'ACCEPTED', 'KOT_PRINTED', 'PREPARED', 'DISPATCHED', 'DELIVERED',
    ])

    // Every event names who did it.
    // The birth event is written by the system and names nobody; every
    // human action after it must name its actor.
    const humanEvents = delivered.events.filter((e) => e.fromStatus !== null)
    expect(humanEvents.length).toBeGreaterThan(0)
    expect(humanEvents.every((e) => e.userId)).toBe(true)
  })
})
