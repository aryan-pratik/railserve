import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { disconnectDb } from '../src/lib/db'
import { TrainStatus } from '../src/lib/models'
import { refreshTrainStatus, readCachedStatus, timingForOrders, timingFor } from '../src/lib/train/service'
import { runTrainPollingTick } from '../src/lib/queue/trainPolling'
import { findMany } from '../src/lib/repo/orderRepo'
import { transitionOrder } from '../src/lib/repo/transitionOrder'
import { ctxFor, makeOrder, makeRestaurant, makeUser, resetDb } from './fixtures'
import { todayIST } from '../src/lib/format'
import type { AuthContext } from '../src/lib/authContext'
import * as providerFactory from '../src/lib/train'
import { TrainStatusUnavailable } from '../src/lib/train/provider'

const KEY = { trainNo: '12506', serviceDate: '2026-08-27', stationCode: 'CNB' }

describe('train status cache', () => {
  beforeAll(async () => {
    await resetDb()
    await TrainStatus.deleteMany({})
  })
  afterAll(async () => {
    await disconnectDb()
  })
  beforeEach(async () => {
    await TrainStatus.deleteMany({})
    vi.restoreAllMocks()
  })

  it('writes a cache row on first fetch', async () => {
    const scheduled = new Date('2026-08-27T13:25:00+05:30')
    const row = await refreshTrainStatus(KEY, { scheduledArrival: scheduled })
    expect(row.provider).toBe('simulator')
    expect(row.delayMinutes).toBeTypeOf('number')
    expect(row.platform).toBeTruthy()
    expect(row.lastError).toBeNull()
    expect(row.lastSuccessAt).toBeInstanceOf(Date)
  })

  it('keeps the last known value when the provider fails, and marks the error', async () => {
    const scheduled = new Date('2026-08-27T13:25:00+05:30')
    const good = await refreshTrainStatus(KEY, { scheduledArrival: scheduled })
    expect(good.lastError).toBeNull()

    // Plan §8: degrade to the last known value, never blank it.
    vi.spyOn(providerFactory, 'getTrainStatusProvider').mockReturnValue({
      name: 'boom',
      getStatus: async () => {
        throw new TrainStatusUnavailable('upstream 503')
      },
    })

    const after = await refreshTrainStatus(KEY, { scheduledArrival: scheduled })
    expect(after.lastError).toContain('503')
    expect(after.etaAt?.getTime()).toBe(good.etaAt?.getTime())
    expect(after.delayMinutes).toBe(good.delayMinutes)
    expect(after.platform).toBe(good.platform)
    // The successful-fetch marker must NOT move on a failure.
    expect(after.lastSuccessAt?.getTime()).toBe(good.lastSuccessAt?.getTime())
  })

  it('keeps the last known value when a successful reading carries no arrival time', async () => {
    const scheduled = new Date('2026-08-27T13:25:00+05:30')
    const good = await refreshTrainStatus(KEY, { scheduledArrival: scheduled })
    expect(good.etaAt).toBeInstanceOf(Date)

    // Seen in production: RailKit returned "--" for Kanpur on 12561 while the
    // halt before it reported 1h26m down and the halt after it carried a
    // projection — only the stop we needed was missing. That is a successful
    // call, not a failure, and copying it over replaced a 10:36 ETA with
    // nothing, so the board fell back to a booked time that still looked like
    // an answer.
    vi.spyOn(providerFactory, 'getTrainStatusProvider').mockReturnValue({
      name: 'blank',
      getStatus: async () => ({ etaAt: null, delayMinutes: null, platform: null, providerUpdatedAt: null }),
    })

    const after = await refreshTrainStatus(KEY, { scheduledArrival: scheduled })
    expect(after.etaAt?.getTime()).toBe(good.etaAt?.getTime())
    expect(after.delayMinutes).toBe(good.delayMinutes)
    expect(after.platform).toBe(good.platform)
    // Nothing was learned, so the "last time we knew something" marker holds —
    // otherwise the age shown to a person resets on an empty answer.
    expect(after.lastSuccessAt?.getTime()).toBe(good.lastSuccessAt?.getTime())
    // It was still a successful call, so it is not reported as a feed failure.
    expect(after.lastError).toBeNull()
  })

  it('still records a reading that has a delay but no arrival time', async () => {
    const scheduled = new Date('2026-08-27T13:25:00+05:30')
    await refreshTrainStatus(KEY, { scheduledArrival: scheduled })

    vi.spyOn(providerFactory, 'getTrainStatusProvider').mockReturnValue({
      name: 'partial',
      getStatus: async () => ({ etaAt: null, delayMinutes: 45, platform: '4', providerUpdatedAt: null }),
    })

    const after = await refreshTrainStatus(KEY, { scheduledArrival: scheduled })
    // A delay with no ETA is still news — "45 minutes down" is actionable.
    expect(after.delayMinutes).toBe(45)
    expect(after.platform).toBe('4')
  })

  it('serves many orders on one train from a single provider call', async () => {
    const spy = vi.spyOn(providerFactory, 'getTrainStatusProvider')
    const orders = Array.from({ length: 10 }, () => ({
      trainNo: '12506',
      serviceDate: '2026-08-27',
      stationCode: 'CNB',
      scheduledArrival: new Date('2026-08-27T13:25:00+05:30'),
    }))

    await timingForOrders(orders)
    const rows = await TrainStatus.countDocuments({ trainNo: '12506' })
    expect(rows).toBe(1)
    // One distinct train, so at most one provider construction for the fetch.
    expect(spy.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('leaves trainless orders on scheduled time and never polls for them', async () => {
    const order = {
      trainNo: null,
      serviceDate: '2026-08-27',
      stationCode: 'CNB',
      scheduledArrival: new Date('2026-08-27T13:25:00+05:30'),
    }
    const map = await timingForOrders([order])
    expect(map.size).toBe(0)

    const t = timingFor(order, map)
    expect(t.source).toBe('SCHEDULED')
    expect(t.effectiveArrival).toEqual(order.scheduledArrival)
    expect(await readCachedStatus(KEY)).toBeNull()
  })
})

describe('polling worker tick', () => {
  let manager: AuthContext
  let admin: AuthContext

  beforeAll(async () => {
    await resetDb()
    await TrainStatus.deleteMany({})
    const r = await makeRestaurant('HOTEL GANGA GALAXY', 'CNB')
    admin = ctxFor(await makeUser('ADMIN', '9000000001'))
    manager = ctxFor(await makeUser('STORE_MANAGER', '9000000002', r._id))

    const today = todayIST()
    // Two orders on one train, one on another, one with no train at all.
    await makeOrder({ restaurantId: r._id, serviceDate: today, trainNo: '12506', stationCode: 'CNB', coach: 'B5', scheduledArrival: new Date(Date.now() + 90 * 60_000) })
    await makeOrder({ restaurantId: r._id, serviceDate: today, trainNo: '12506', stationCode: 'CNB', coach: 'B6', scheduledArrival: new Date(Date.now() + 90 * 60_000) })
    await makeOrder({ restaurantId: r._id, serviceDate: today, trainNo: '12312', stationCode: 'CNB', coach: 'A1', scheduledArrival: new Date(Date.now() + 30 * 60_000) })
    await makeOrder({ restaurantId: r._id, serviceDate: today, trainNo: null, stationCode: 'CNB' })
  })

  afterAll(async () => {
    await disconnectDb()
  })

  it('polls one row per train, ignoring the trainless order', async () => {
    const s = await runTrainPollingTick()
    expect(s.trainsConsidered).toBe(2)
    expect(s.refreshed).toBe(2)
    expect(await TrainStatus.countDocuments({})).toBe(2)
  })

  it('skips trains whose reading is still inside its tier', async () => {
    const s = await runTrainPollingTick()
    expect(s.refreshed).toBe(0)
    expect(s.skippedFresh).toBe(2)
  })

  it('does not fire leave-now while the kitchen still has the order', async () => {
    const s = await runTrainPollingTick()
    expect(s.leaveNowFired).toEqual([])
  })

  it('fires leave-now once the run is prepared and the time has come', async () => {
    // Push the order to PREPARED with an arrival already in the past, so
    // dispatchAt (eta - walk - buffer) is behind us.
    const orders = await findMany(admin, { trainNo: '12506' })
    for (const o of orders) {
      for (const to of ['ACCEPTED', 'KOT_PRINTED', 'PREPARED'] as const) {
        await transitionOrder({ ctx: manager, orderId: String(o._id), to })
      }
    }
    await TrainStatus.updateOne(
      { trainNo: '12506' },
      { $set: { etaAt: new Date(Date.now() - 60 * 60_000), fetchedAt: new Date() } },
    )

    const s = await runTrainPollingTick()
    expect(s.leaveNowFired.length).toBe(1)

    const after = await findMany(admin, { trainNo: '12506' })
    for (const o of after) {
      expect(o.events.some((e) => (e.meta as Record<string, unknown>)?.action === 'LEAVE_NOW')).toBe(true)
    }
  })

  it('does not fire leave-now twice for the same run', async () => {
    const s = await runTrainPollingTick()
    expect(s.leaveNowFired).toEqual([])

    const after = await findMany(admin, { trainNo: '12506' })
    for (const o of after) {
      const fired = o.events.filter((e) => (e.meta as Record<string, unknown>)?.action === 'LEAVE_NOW')
      expect(fired).toHaveLength(1)
    }
  })
})
