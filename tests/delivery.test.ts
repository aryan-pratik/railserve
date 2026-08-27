import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { disconnectDb } from '../src/lib/db'
import { findById, findMany } from '../src/lib/repo/orderRepo'
import { transitionOrder, assignAgents } from '../src/lib/repo/transitionOrder'
import { assignRun, dispatchRun, findRun, findRuns } from '../src/lib/repo/runRepo'
import { ForbiddenError, type AuthContext } from '../src/lib/authContext'
import { runKeyFor } from '../src/lib/runs'
import { ctxFor, makeOrder, makeRestaurant, makeUser, resetDb } from './fixtures'

const DATE = '2026-08-27'

describe('delivery: assignment, dispatch, proof', () => {
  let admin: AuthContext
  let manager: AuthContext
  let agentA: AuthContext
  let agentB: AuthContext
  let agentAId: import('mongoose').Types.ObjectId
  let agentBId: import('mongoose').Types.ObjectId
  let restaurantId: import('mongoose').Types.ObjectId
  let runKey: string

  beforeAll(async () => {
    await resetDb()
    const r = await makeRestaurant('HOTEL GANGA GALAXY', 'CNB')
    restaurantId = r._id
    admin = ctxFor(await makeUser('ADMIN', '9000000001'))
    manager = ctxFor(await makeUser('STORE_MANAGER', '9000000002', r._id))
    const a = await makeUser('DELIVERY_AGENT', '9000000004')
    const b = await makeUser('DELIVERY_AGENT', '9000000005')
    agentAId = a._id
    agentBId = b._id
    agentA = ctxFor(a)
    agentB = ctxFor(b)

    // Three orders on one train, deliberately out of coach order.
    for (const coach of ['S9', 'B2', 'A1']) {
      await makeOrder({
        restaurantId, serviceDate: DATE, trainNo: '12506', trainName: 'NORTH EAST EXP',
        stationCode: 'CNB', coach, berth: '11', rawSeat: `${coach}-11`,
        scheduledArrival: new Date('2026-08-27T07:55:00Z'),
      })
    }
    // A second train, so grouping has something to separate it from.
    await makeOrder({
      restaurantId, serviceDate: DATE, trainNo: '12312', trainName: 'KALKA MAIL',
      stationCode: 'CNB', coach: 'B1', scheduledArrival: new Date('2026-08-27T04:10:00Z'),
    })

    runKey = runKeyFor({ trainNo: '12506', serviceDate: DATE, stationCode: 'CNB' })
  })

  afterAll(async () => {
    await disconnectDb()
  })

  it('an unassigned agent sees no runs at all', async () => {
    expect(await findRuns(agentA, DATE)).toHaveLength(0)
  })

  it('admin assigns a whole run in one action', async () => {
    const res = await assignRun(admin, runKey, [String(agentAId)])
    expect(res.moved).toBe(3)
    expect(res.errors).toEqual([])

    const runs = await findRuns(agentA, DATE)
    expect(runs).toHaveLength(1)
    expect(runs[0].orders).toHaveLength(3)
  })

  it('sorts the run by coach so the agent walks one direction', async () => {
    const run = await findRun(agentA, runKey)
    expect(run!.orders.map((o) => o.coach)).toEqual(['A1', 'B2', 'S9'])
  })

  it('keeps the other train out of this agent\'s run', async () => {
    const runs = await findRuns(agentA, DATE)
    expect(runs.map((r) => r.trainNo)).toEqual(['12506'])
  })

  it('a different agent still sees nothing', async () => {
    expect(await findRuns(agentB, DATE)).toHaveLength(0)
  })

  it('refuses to dispatch when nothing is prepared', async () => {
    const res = await dispatchRun(agentA, runKey)
    expect(res.moved).toBe(0)
    expect(res.skipped).toBe(3)
  })

  it('only a delivery agent may dispatch a run', async () => {
    await expect(dispatchRun(admin, runKey)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(dispatchRun(manager, runKey)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('dispatches what is ready and leaves the rest for the kitchen', async () => {
    const run = await findRun(agentA, runKey)
    // Two of three make it through the kitchen.
    for (const o of run!.orders.slice(0, 2)) {
      for (const to of ['ACCEPTED', 'KOT_PRINTED', 'PREPARED'] as const) {
        await transitionOrder({ ctx: manager, orderId: String(o._id), to })
      }
    }

    const res = await dispatchRun(agentA, runKey)
    expect(res.moved).toBe(2)
    expect(res.skipped).toBe(1)
    expect(res.errors).toEqual([])
  })

  it('delivers with proof and records the cash collected', async () => {
    const run = await findRun(agentA, runKey)
    const dispatched = run!.orders.find((o) => o.status === 'DISPATCHED')!
    const id = String(dispatched._id)

    const done = await transitionOrder({
      ctx: agentA, orderId: id, to: 'DELIVERED',
      apply: {
        proofType: 'SIGNATURE', proofValue: 'Neelesh Soni', amountCollectedPaise: 12000,
      },
    })

    expect(done.status).toBe('DELIVERED')
    expect(done.delivery.proofValue).toBe('Neelesh Soni')
    expect(done.delivery.amountCollectedPaise).toBe(12000)
    expect(done.delivery.deliveredAt).toBeInstanceOf(Date)
    expect(done.delivery.dispatchedAt).toBeInstanceOf(Date)
  })

  it('records a failure with its reason', async () => {
    const run = await findRun(agentA, runKey)
    const dispatched = run!.orders.find((o) => o.status === 'DISPATCHED')!

    const failed = await transitionOrder({
      ctx: agentA, orderId: String(dispatched._id), to: 'FAILED',
      apply: { failureReason: 'Passenger not at seat, train did not halt' },
    })

    expect(failed.status).toBe('FAILED')
    expect(failed.delivery.failureReason).toContain('not at seat')
  })

  it('an agent cannot deliver an order assigned to somebody else', async () => {
    await assignAgents({ ctx: admin, orderId: String((await findMany(admin))[0]._id), agentIds: [String(agentBId)] })
    const bOrders = await findMany(agentB)
    expect(bOrders).toHaveLength(1)

    // And agent A can no longer see it.
    expect(await findById(agentA, String(bOrders[0]._id))).toBeNull()
  })

  it('leaves a complete audit trail from creation to delivery', async () => {
    const delivered = (await findMany(admin, { status: 'DELIVERED' }))[0]

    // Status changes only. Assignment is audited onto the same array with
    // fromStatus === toStatus, which is a side-effect entry, not a transition.
    const trail = delivered.events
      .filter((e) => e.fromStatus !== e.toStatus)
      .map((e) => e.toStatus)
    expect(trail).toEqual([
      'ACCEPTED', 'KOT_PRINTED', 'PREPARED', 'DISPATCHED', 'DELIVERED',
    ])

    // The assignment is still on the record — who it was handed to, and when.
    const assignment = delivered.events.find((e) => e.meta?.action === 'ASSIGN_AGENTS')
    expect(assignment).toBeDefined()

    // Every event names who did it.
    expect(delivered.events.every((e) => e.userId)).toBe(true)
  })
})
