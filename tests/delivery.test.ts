import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { disconnectDb } from '../src/lib/db'
import { findById, findMany } from '../src/lib/repo/orderRepo'
import { transitionOrder, assignAgents } from '../src/lib/repo/transitionOrder'
import { dispatchRun, findRun, findRuns, handRunToRider, transitionRun } from '../src/lib/repo/runRepo'
import { ForbiddenError, NotFoundError, type AuthContext } from '../src/lib/authContext'
import { runKeyFor } from '../src/lib/runs'
import { assignRider, ctxFor, makeOrder, makeRestaurant, makeUser, resetDb } from './fixtures'

const DATE = '2026-08-27'

/**
 * Riders are assigned work by a telecaller, store manager or admin, and see
 * only that. These tests pin both halves: a rider sees what is assigned to
 * them at their own outlet and nothing else, and delivering writes them onto
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

    // Three orders on one train, deliberately out of coach order, all given
    // to rider A.
    for (const coach of ['S9', 'B2', 'A1']) {
      const o = await makeOrder({
        restaurantId: ganga, serviceDate: DATE, trainNo: '12506', trainName: 'NORTH EAST EXP',
        stationCode: 'CNB', coach, berth: '11', rawSeat: `${coach}-11`,
        scheduledArrival: new Date('2026-08-27T07:55:00Z'),
      })
      await assignRider(o._id, a._id)
    }
    // A second train at the same kitchen, given to rider B.
    const kalka = await makeOrder({
      restaurantId: ganga, serviceDate: DATE, trainNo: '12312', trainName: 'KALKA MAIL',
      stationCode: 'CNB', coach: 'B1', scheduledArrival: new Date('2026-08-27T04:10:00Z'),
    })
    await assignRider(kalka._id, b._id)
    // Nobody has been given this one yet.
    await makeOrder({
      restaurantId: ganga, serviceDate: DATE, trainNo: '12004', trainName: 'SHATABDI EXP',
      stationCode: 'CNB', coach: 'S4', scheduledArrival: new Date('2026-08-27T05:00:00Z'),
    })
    // An order at the other station entirely, given to the rider there.
    const pryj = await makeOrder({
      restaurantId: other._id, serviceDate: DATE, trainNo: '12801', stationCode: 'PRYJ',
      coach: 'A2', scheduledArrival: new Date('2026-08-27T06:00:00Z'),
    })
    await assignRider(pryj._id, outsider._id)

    runKey = runKeyFor({ trainNo: '12506', serviceDate: DATE, stationCode: 'CNB' })
  })

  let outsiderCtx: AuthContext

  afterAll(async () => {
    await disconnectDb()
  })

  it('a rider sees only the orders assigned to them', async () => {
    expect((await findRuns(riderA, DATE)).map((r) => r.trainNo)).toEqual(['12506'])
    expect((await findRuns(riderB, DATE)).map((r) => r.trainNo)).toEqual(['12312'])
  })

  it('a rider cannot see or take an order assigned to someone else', async () => {
    const theirs = (await findRun(riderA, runKey))!.orders[0]
    expect(await findById(riderB, String(theirs._id))).toBeNull()
  })

  it('an order nobody has been given is invisible to every rider', async () => {
    const unassigned = (await findMany(admin, { trainNo: '12004', restaurantId: ganga }))[0]
    for (const o of ['ACCEPTED', 'KOT_PRINTED', 'PREPARED'] as const) {
      await transitionOrder({ ctx: manager, orderId: String(unassigned._id), to: o })
    }
    expect(await findById(riderA, String(unassigned._id))).toBeNull()
    await expect(
      transitionOrder({ ctx: riderA, orderId: String(unassigned._id), to: 'DISPATCHED' }),
    ).rejects.toBeInstanceOf(NotFoundError)
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

  it('records which rider dispatched', async () => {
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
    const run = await findRun(riderA, runKey)
    const dispatched = run!.orders.find((o) => o.status === 'DISPATCHED')!

    // Another rider cannot close it, even holding its id.
    await expect(
      transitionOrder({ ctx: riderB, orderId: String(dispatched._id), to: 'DELIVERED' }),
    ).rejects.toBeInstanceOf(NotFoundError)

    const done = await transitionOrder({
      ctx: riderA, orderId: String(dispatched._id), to: 'DELIVERED',
      apply: { proofType: 'SIGNATURE', proofValue: 'Neelesh Soni' },
    })

    expect(done.status).toBe('DELIVERED')
    expect(done.delivery.agentIds.map(String)).toEqual([String(riderAId)])
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

/**
 * A store manager can push food out on a rider's behalf — but the record has
 * to name the rider, never the manager. "Who has my food" is the only question
 * delivery.agentIds exists to answer.
 */
describe('store manager hands a run to a rider', () => {
  let manager: AuthContext
  let rider: AuthContext
  let riderId: import('mongoose').Types.ObjectId
  let managerId: import('mongoose').Types.ObjectId
  let runKey2: string
  let outlet: import('mongoose').Types.ObjectId

  beforeAll(async () => {
    await resetDb()
    const g = await makeRestaurant('HOTEL GANGA GALAXY', 'CNB')
    outlet = g._id
    const m = await makeUser('STORE_MANAGER', '9000000020', g._id)
    const r = await makeUser('DELIVERY_AGENT', '9000000021', g._id)
    managerId = m._id
    riderId = r._id
    manager = ctxFor(m)
    rider = ctxFor(r)

    await makeOrder({
      restaurantId: outlet, serviceDate: DATE, trainNo: '12951', trainName: 'RAJDHANI',
      stationCode: 'CNB', coach: 'A1', scheduledArrival: new Date('2026-08-27T09:00:00Z'),
    })
    runKey2 = runKeyFor({ trainNo: '12951', serviceDate: DATE, stationCode: 'CNB' })

    const run = await findRun(manager, runKey2)
    for (const to of ['ACCEPTED', 'KOT_PRINTED', 'PREPARED'] as const) {
      await transitionOrder({ ctx: manager, orderId: String(run!.orders[0]._id), to })
    }
  })

  afterAll(async () => {
    await disconnectDb()
  })

  it('records the named rider, not the manager who clicked', async () => {
    const res = await handRunToRider(manager, runKey2, String(riderId))
    expect(res.moved).toBe(1)
    expect(res.errors).toEqual([])

    const run = await findRun(rider, runKey2)
    const order = run!.orders[0]
    expect(order.status).toBe('DISPATCHED')
    expect(order.delivery.agentIds.map(String)).toEqual([String(riderId)])
    expect(order.delivery.agentIds.map(String)).not.toContain(String(managerId))
  })

  it('refuses an id that is not an active rider', async () => {
    const res = await handRunToRider(manager, runKey2, String(managerId))
    expect(res.moved).toBe(0)
    expect(res.errors[0]).toContain('not active')
  })

  it('refuses a malformed rider id without touching anything', async () => {
    const res = await handRunToRider(manager, runKey2, 'not-an-id')
    expect(res.moved).toBe(0)
    expect(res.errors[0]).toContain('Choose which rider')
  })

  it('a rider still cannot be handed another outlet’s run', async () => {
    const other = await makeRestaurant('SHREE ANNAPURNA', 'PRYJ')
    const outsider = ctxFor(await makeUser('STORE_MANAGER', '9000000022', other._id))
    const res = await handRunToRider(outsider, runKey2, String(riderId))
    expect(res.moved).toBe(0)
    expect(res.errors[0]).toContain('Run not found')
  })
})

/**
 * One train is not always one trip: some of its orders are ready before the
 * rest, and orders spread down a long rake can need more than one rider. The
 * board's ticks narrow a run action to the chosen orders.
 */
describe('acting on some orders of a train', () => {
  let manager: AuthContext
  let riderA: import('mongoose').Types.ObjectId
  let riderB: import('mongoose').Types.ObjectId
  let runKey3: string
  let ids: string[]

  beforeAll(async () => {
    await resetDb()
    const g = await makeRestaurant('HOTEL GANGA GALAXY', 'CNB')
    manager = ctxFor(await makeUser('STORE_MANAGER', '9000000030', g._id))
    riderA = (await makeUser('DELIVERY_AGENT', '9000000031', g._id))._id
    riderB = (await makeUser('DELIVERY_AGENT', '9000000032', g._id))._id

    for (const coach of ['A1', 'B2', 'S9']) {
      await makeOrder({
        restaurantId: g._id, serviceDate: DATE, trainNo: '12301', trainName: 'RAJDHANI',
        stationCode: 'CNB', coach, scheduledArrival: new Date('2026-08-27T09:00:00Z'),
      })
    }
    runKey3 = runKeyFor({ trainNo: '12301', serviceDate: DATE, stationCode: 'CNB' })
    const run = await findRun(manager, runKey3)
    ids = run!.orders.map((o) => String(o._id))
    for (const id of ids) {
      for (const to of ['ACCEPTED', 'KOT_PRINTED'] as const) {
        await transitionOrder({ ctx: manager, orderId: id, to })
      }
    }
  })

  afterAll(async () => {
    await disconnectDb()
  })

  const statusOf = async (id: string) => (await findById(manager, id))!.status

  it('marks only the ticked orders ready', async () => {
    const res = await transitionRun(manager, runKey3, 'KOT_PRINTED', 'PREPARED', {}, { orderIds: ids.slice(0, 2) })
    expect(res.moved).toBe(2)
    expect(await statusOf(ids[0])).toBe('PREPARED')
    expect(await statusOf(ids[1])).toBe('PREPARED')
    expect(await statusOf(ids[2])).toBe('KOT_PRINTED')
  })

  it('ignores an id that is not on this run', async () => {
    const res = await transitionRun(manager, runKey3, 'KOT_PRINTED', 'PREPARED', {}, {
      orderIds: ['000000000000000000000000'],
    })
    expect(res.moved).toBe(0)
    expect(await statusOf(ids[2])).toBe('KOT_PRINTED')
  })

  it('hands different orders on one train to different riders', async () => {
    const a = await handRunToRider(manager, runKey3, String(riderA), { orderIds: [ids[0]] })
    const b = await handRunToRider(manager, runKey3, String(riderB), { orderIds: [ids[1]] })
    expect(a.moved).toBe(1)
    expect(b.moved).toBe(1)

    const first = await findById(manager, ids[0])
    const second = await findById(manager, ids[1])
    expect(first!.status).toBe('DISPATCHED')
    expect(first!.delivery.agentIds.map(String)).toEqual([String(riderA)])
    expect(second!.delivery.agentIds.map(String)).toEqual([String(riderB)])
    // Still in the kitchen, so untouched by either handover.
    expect(await statusOf(ids[2])).toBe('KOT_PRINTED')
  })

  it('an admin can hand an order to a rider too, but only by naming one', async () => {
    const admin = ctxFor(await makeUser('ADMIN', '9000000033'))
    await transitionRun(admin, runKey3, 'KOT_PRINTED', 'PREPARED', {}, { orderIds: [ids[2]] })
    await expect(
      transitionOrder({ ctx: admin, orderId: ids[2], to: 'DISPATCHED' }),
    ).rejects.toBeInstanceOf(ForbiddenError)

    const res = await handRunToRider(admin, runKey3, String(riderB), { orderIds: [ids[2]] })
    expect(res).toEqual({ moved: 1, skipped: 0, errors: [] })
    const order = await findById(admin, ids[2])
    expect(order!.delivery.agentIds.map(String)).toEqual([String(riderB)])
  })
})

/**
 * Marking an order picked up is one tap on a phone held in a busy hand, so it
 * gets mistapped. Putting it back has to be a correction rather than an
 * erasure: the food returns to the counter, the order stays assigned to the
 * same rider (only the office reassigns), and both halves stay on the event
 * log.
 */
describe('a rider puts back an order they took by mistake', () => {
  let manager: AuthContext
  let rider: AuthContext
  let riderId: import('mongoose').Types.ObjectId
  let orderId: string

  beforeAll(async () => {
    await resetDb()
    const g = await makeRestaurant('HOTEL GANGA GALAXY', 'CNB')
    manager = ctxFor(await makeUser('STORE_MANAGER', '9000000002', g._id))
    const r = await makeUser('DELIVERY_AGENT', '9000000004', g._id)
    riderId = r._id
    rider = ctxFor(r)

    const order = await makeOrder({
      restaurantId: g._id, serviceDate: DATE, trainNo: '12506', trainName: 'NORTH EAST EXP',
      stationCode: 'CNB', coach: 'B5', berth: '37',
      scheduledArrival: new Date('2026-08-27T07:55:00Z'),
    })
    orderId = String(order._id)
    await assignRider(orderId, riderId)

    for (const to of ['ACCEPTED', 'KOT_PRINTED', 'PREPARED'] as const) {
      await transitionOrder({ ctx: manager, orderId, to })
    }
    await transitionOrder({ ctx: rider, orderId, to: 'DISPATCHED' })
  })

  afterAll(async () => {
    await disconnectDb()
  })

  it('goes back to the counter and stays assigned to the rider', async () => {
    const before = await findById(rider, orderId)
    expect(before!.status).toBe('DISPATCHED')
    expect(before!.delivery.agentIds.map(String)).toContain(String(riderId))

    const back = await transitionOrder({ ctx: rider, orderId, to: 'PREPARED' })

    expect(back.status).toBe('PREPARED')
    // Still theirs: a rider cannot hand their own assignment back. The board
    // counts only DISPATCHED orders as carried, so it stops showing it as out.
    expect(back.delivery.agentIds.map(String)).toEqual([String(riderId)])
  })

  it('keeps both the take and the return on the event log', async () => {
    const order = await findById(rider, orderId)
    const edges = (order!.events ?? []).map((e) => `${e.fromStatus}->${e.toStatus}`)

    expect(edges).toContain('PREPARED->DISPATCHED')
    expect(edges).toContain('DISPATCHED->PREPARED')

    const undo = order!.events.find((e) => e.toStatus === 'PREPARED' && e.fromStatus === 'DISPATCHED')
    expect(String(undo!.userId)).toBe(String(riderId))
  })

  it('is available to take again afterwards', async () => {
    const again = await transitionOrder({ ctx: rider, orderId, to: 'DISPATCHED' })
    expect(again.status).toBe('DISPATCHED')
    expect(again.delivery.agentIds.map(String)).toContain(String(riderId))
  })

  it('is not something a store manager may do', async () => {
    await expect(
      transitionOrder({ ctx: manager, orderId, to: 'PREPARED' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})
