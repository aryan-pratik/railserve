import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { disconnectDb } from '../src/lib/db'
import { Order, TrainStatus } from '../src/lib/models'
import {
  refreshTrainStatus, readCachedStatus, timingForOrders, timingFor, forceRefreshTrainStatus, lookupTrainDetail,
} from '../src/lib/train/service'
import { runTrainPollingTick } from '../src/lib/queue/trainPolling'
import { findMany } from '../src/lib/repo/orderRepo'
import { transitionOrder } from '../src/lib/repo/transitionOrder'
import { ctxFor, makeOrder, makeRestaurant, makeUser, resetDb } from './fixtures'
import { shiftServiceDate, todayIST } from '../src/lib/format'
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
      getStatus: async () => ({ etaAt: null, delayMinutes: null, platform: null, providerUpdatedAt: null, arrived: false }),
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

  it('marks a row arrived from a successful reading, and never un-marks it', async () => {
    vi.spyOn(providerFactory, 'getTrainStatusProvider').mockReturnValue({
      name: 'departed',
      getStatus: async () => ({
        etaAt: new Date('2026-08-27T13:39:00+05:30'),
        delayMinutes: 4,
        platform: '2',
        providerUpdatedAt: null,
        arrived: true,
      }),
    })
    const arrived = await refreshTrainStatus(KEY, { scheduledArrival: new Date('2026-08-27T13:25:00+05:30') })
    expect(arrived.arrived).toBe(true)

    // A later call claiming arrived:false — a stale cached response replayed,
    // say — must not put the train back into rotation. $max only ever moves
    // this forward.
    vi.spyOn(providerFactory, 'getTrainStatusProvider').mockReturnValue({
      name: 'confused',
      getStatus: async () => ({
        etaAt: new Date('2026-08-27T13:39:00+05:30'),
        delayMinutes: 4,
        platform: '2',
        providerUpdatedAt: null,
        arrived: false,
      }),
    })
    const after = await refreshTrainStatus(KEY, { scheduledArrival: new Date('2026-08-27T13:25:00+05:30') })
    expect(after.arrived).toBe(true)
  })

  it('still records a reading that has a delay but no arrival time', async () => {
    const scheduled = new Date('2026-08-27T13:25:00+05:30')
    await refreshTrainStatus(KEY, { scheduledArrival: scheduled })

    vi.spyOn(providerFactory, 'getTrainStatusProvider').mockReturnValue({
      name: 'partial',
      getStatus: async () => ({ etaAt: null, delayMinutes: 45, platform: '4', providerUpdatedAt: null, arrived: false }),
    })

    const after = await refreshTrainStatus(KEY, { scheduledArrival: scheduled })
    // A delay with no ETA is still news — "45 minutes down" is actionable.
    expect(after.delayMinutes).toBe(45)
    expect(after.platform).toBe('4')
  })

  describe('forceRefreshTrainStatus — the "check now" button', () => {
    it('hits the provider even when the row is fresh, unlike the tiered path', async () => {
      const scheduled = new Date('2026-08-27T13:25:00+05:30')
      const first = await refreshTrainStatus(KEY, { scheduledArrival: scheduled })
      expect(first.lastError).toBeNull()

      const spy = vi.spyOn(providerFactory, 'getTrainStatusProvider')
      await forceRefreshTrainStatus({
        trainNo: KEY.trainNo,
        serviceDate: KEY.serviceDate,
        stationCode: KEY.stationCode,
        scheduledArrival: scheduled,
      })
      // The row was seconds old — getTrainStatus would have skipped it as
      // fresh. A forced refresh must ask anyway, which is the whole point of
      // a person clicking a "check now" button.
      expect(spy).toHaveBeenCalled()
    })

    it('returns null for an order with no train, rather than throwing', async () => {
      const result = await forceRefreshTrainStatus({
        trainNo: null,
        serviceDate: '2026-08-27',
        stationCode: 'CNB',
      })
      expect(result).toBeNull()
    })

    it('surfaces a provider failure on the row, for the caller to show', async () => {
      vi.spyOn(providerFactory, 'getTrainStatusProvider').mockReturnValue({
        name: 'boom',
        getStatus: async () => {
          throw new TrainStatusUnavailable('quota exhausted')
        },
      })
      const row = await forceRefreshTrainStatus({
        trainNo: KEY.trainNo,
        serviceDate: KEY.serviceDate,
        stationCode: KEY.stationCode,
      })
      expect(row?.lastError).toContain('quota exhausted')
    })
  })

  describe('a booking the railway timetable puts on another day', () => {
    // 15565: booked into CNB at 00:02 on the 30th, timetabled 23:40 on the 29th.
    const RUN = { trainNo: '15565', serviceDate: '2026-10-30', stationCode: 'CNB' }
    const BOOKED = new Date('2026-10-30T00:02:00+05:30')
    const TIMETABLE = new Date('2026-10-29T23:40:00+05:30')

    function railway(timetableAt: Date | null = TIMETABLE) {
      const getStatus = vi.fn(async () => ({
        etaAt: new Date('2026-10-30T00:34:00+05:30'),
        delayMinutes: 54,
        platform: '5',
        providerUpdatedAt: null,
        arrived: false,
        timetableAt,
      }))
      vi.spyOn(providerFactory, 'getTrainStatusProvider').mockReturnValue({ name: 'railkit', getStatus })
      return getStatus
    }

    beforeEach(async () => {
      await Order.deleteMany({ trainNo: { $in: [RUN.trainNo, '12427'] } })
      // The evening of the 29th, with the train still to come. Only Date is
      // faked: the database driver's own timers keep running.
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-10-29T20:00:00+05:30'))
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('moves the order onto the evening before, keeping what was booked and logging it', async () => {
      const order = await makeOrder({ ...RUN, scheduledArrival: BOOKED })
      railway()

      const row = await refreshTrainStatus(RUN, { scheduledArrival: BOOKED })
      expect(row.timetableAt).toEqual(TIMETABLE)

      const after = await Order.findById(order._id).lean()
      expect(after!.scheduledArrival).toEqual(TIMETABLE)
      expect(after!.bookedArrival).toEqual(BOOKED)
      // The day it reaches the platform, so the 29th's board and polls have it.
      expect(after!.serviceDate).toBe('2026-10-29')
      const moves = after!.events.filter((e) => e.meta?.via === 'railway-timetable')
      expect(moves.map((e) => e.meta)).toEqual([
        expect.objectContaining({ action: 'FIELD_EDITED', field: 'scheduledArrival', from: BOOKED.toISOString(), to: TIMETABLE.toISOString() }),
        expect.objectContaining({ action: 'FIELD_EDITED', field: 'serviceDate', from: '2026-10-30', to: '2026-10-29' }),
      ])
      expect(moves.every((e) => e.fromStatus === e.toStatus && e.userId === null)).toBe(true)
    })

    it('keeps the service date when the correction only comes after midnight', async () => {
      // The 29th is already over: moved there, a still-open order would leave
      // Today and the rollover window. Its time is corrected; its day stays.
      vi.setSystemTime(new Date('2026-10-30T08:00:00+05:30'))
      const order = await makeOrder({ ...RUN, scheduledArrival: BOOKED })
      railway()

      await refreshTrainStatus(RUN)
      const after = await Order.findById(order._id).lean()
      expect(after!.scheduledArrival).toEqual(TIMETABLE)
      expect(after!.serviceDate).toBe(RUN.serviceDate)
      expect(after!.events.filter((e) => e.meta?.via === 'railway-timetable').map((e) => e.meta?.field))
        .toEqual(['scheduledArrival'])
    })

    it('keeps the service date when the train moves past midnight', async () => {
      // Moving it forward would drop it off Today while the train is coming;
      // the past-midnight rollover already keeps it there.
      const run = { ...RUN, serviceDate: '2026-10-29' }
      const booked = new Date('2026-10-29T23:50:00+05:30')
      const timetable = new Date('2026-10-30T00:10:00+05:30')
      const order = await makeOrder({ ...run, scheduledArrival: booked })
      railway(timetable)

      await refreshTrainStatus(run)
      const after = await Order.findById(order._id).lean()
      expect(after!.scheduledArrival).toEqual(timetable)
      expect(after!.serviceDate).toBe('2026-10-29')
    })

    it('picks the run against the earliest open booking, whichever order asks', async () => {
      await makeOrder({ ...RUN, scheduledArrival: BOOKED })
      await makeOrder({ ...RUN, scheduledArrival: new Date('2026-10-30T01:00:00+05:30') })
      const getStatus = railway()

      await refreshTrainStatus(RUN, { scheduledArrival: new Date('2026-10-30T01:00:00+05:30') })
      expect(getStatus).toHaveBeenCalledWith(RUN.trainNo, RUN.serviceDate, RUN.stationCode, BOOKED)
    })

    it('does it once, however many reads follow', async () => {
      const order = await makeOrder({ ...RUN, scheduledArrival: BOOKED })
      railway()

      await refreshTrainStatus(RUN, { scheduledArrival: BOOKED })
      await refreshTrainStatus(RUN, { scheduledArrival: BOOKED })
      await timingForOrders([{ ...RUN, scheduledArrival: BOOKED }], { allowFetch: false })

      const after = await Order.findById(order._id).lean()
      expect(after!.events.filter((e) => e.meta?.field === 'scheduledArrival')).toHaveLength(1)
      expect(after!.bookedArrival).toEqual(BOOKED)
    })

    it('leaves a same-day booking alone', async () => {
      const order = await makeOrder({ ...RUN, scheduledArrival: BOOKED })
      railway(new Date('2026-10-30T00:20:00+05:30'))

      await refreshTrainStatus(RUN, { scheduledArrival: BOOKED })
      const after = await Order.findById(order._id).lean()
      expect(after!.scheduledArrival).toEqual(BOOKED)
      expect(after!.bookedArrival).toBeNull()
    })

    it('leaves closed orders and an admin\'s own arrival time alone', async () => {
      const closed = await makeOrder({ ...RUN, scheduledArrival: BOOKED, status: 'DELIVERED' })
      const byHand = await makeOrder({
        ...RUN,
        scheduledArrival: BOOKED,
        events: [{
          fromStatus: 'RECEIVED', toStatus: 'RECEIVED', userId: null, createdAt: new Date(),
          meta: { action: 'FIELD_EDITED', field: 'scheduledArrival', via: 'admin-detail' },
        }],
      })
      railway()

      await refreshTrainStatus(RUN, { scheduledArrival: BOOKED })
      for (const id of [closed._id, byHand._id]) {
        const after = await Order.findById(id).lean()
        expect(after!.scheduledArrival).toEqual(BOOKED)
        expect(after!.serviceDate).toBe(RUN.serviceDate)
      }
    })

    it('moves an order that joins a run whose reading is still fresh', async () => {
      await makeOrder({ ...RUN, scheduledArrival: BOOKED })
      railway()
      await refreshTrainStatus(RUN, { scheduledArrival: BOOKED })

      // A second booking arrives inside the reading's tier: no fetch is due.
      const late = await makeOrder({ ...RUN, scheduledArrival: BOOKED })
      await timingForOrders([late])
      const after = await Order.findById(late._id).lean()
      expect(after!.scheduledArrival).toEqual(TIMETABLE)
    })

    it('shows the railway\'s day on screen even before the order is moved', async () => {
      railway()
      await refreshTrainStatus(RUN, { scheduledArrival: BOOKED }) // no order on the run yet
      const timings = await timingForOrders([{ ...RUN, scheduledArrival: BOOKED }], { allowFetch: false })
      expect(timingFor({ ...RUN, scheduledArrival: BOOKED }, timings).scheduledArrival).toEqual(TIMETABLE)
    })

    it('replaces another day\'s run on the row instead of keeping its arrival', async () => {
      // Last night's train latched this row arrived; tonight's booking on the
      // same key must neither inherit that nor be left unpolled by it.
      vi.setSystemTime(new Date('2026-10-30T20:00:00+05:30'))
      await TrainStatus.create({
        ...RUN, etaAt: new Date('2026-10-30T00:34:00+05:30'), arrived: true,
        // Last asked as that train went by; nothing has polled it since.
        timetableAt: TIMETABLE,
        fetchedAt: new Date('2026-10-30T00:40:00+05:30'),
        lastSuccessAt: new Date('2026-10-30T00:40:00+05:30'),
      })
      const tonight = new Date('2026-10-30T23:40:00+05:30')
      await makeOrder({ ...RUN, scheduledArrival: tonight })
      const getStatus = vi.fn(async () => ({
        etaAt: new Date('2026-10-30T23:45:00+05:30'), delayMinutes: 5, platform: null,
        providerUpdatedAt: null, arrived: false, timetableAt: tonight,
      }))
      vi.spyOn(providerFactory, 'getTrainStatusProvider').mockReturnValue({ name: 'railkit', getStatus })

      const timings = await timingForOrders([{ ...RUN, scheduledArrival: tonight }])
      expect(getStatus).toHaveBeenCalledTimes(1)
      const row = await readCachedStatus(RUN)
      expect(row!.arrived).toBe(false)
      expect(row!.etaAt).toEqual(new Date('2026-10-30T23:45:00+05:30'))
      expect(timingFor({ ...RUN, scheduledArrival: tonight }, timings).arrived).toBe(false)
    })

    it('never shows a time an admin set by hand as the railway\'s', async () => {
      railway()
      await refreshTrainStatus(RUN, { scheduledArrival: BOOKED })
      const byHand = {
        ...RUN,
        scheduledArrival: BOOKED,
        events: [{ meta: { action: 'FIELD_EDITED', field: 'scheduledArrival', via: 'admin-detail' } }],
      }
      const timings = await timingForOrders([byHand], { allowFetch: false })
      expect(timingFor(byHand, timings).scheduledArrival).toEqual(BOOKED)
    })

    it('does not let an admin lookup write a run nobody booked into the cache', async () => {
      const lookup = { trainNo: '12427', serviceDate: '2026-10-30', stationCode: 'CNB' }
      vi.spyOn(providerFactory, 'getTrainStatusProvider').mockReturnValue({
        name: 'railkit',
        getStatus: async () => ({
          etaAt: new Date('2026-10-30T23:52:00+05:30'), delayMinutes: 0, platform: '3',
          providerUpdatedAt: null, arrived: true,
        }),
      })
      const detail = await lookupTrainDetail(lookup)
      expect(detail.platform).toBe('3')
      expect(await readCachedStatus(lookup)).toBeNull()
    })
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

  it('polls tomorrow\'s orders booked within the next few hours, not later ones', async () => {
    const r = await makeRestaurant('NIGHT KITCHEN', 'CNB')
    const tomorrow = shiftServiceDate(todayIST(), 1)
    // On its way tonight: the timetable may have it in before midnight.
    await makeOrder({ restaurantId: r._id, serviceDate: tomorrow, trainNo: '15565', stationCode: 'CNB', scheduledArrival: new Date(Date.now() + 3 * 3_600_000) })
    // Tomorrow afternoon: nothing to learn yet.
    await makeOrder({ restaurantId: r._id, serviceDate: tomorrow, trainNo: '12555', stationCode: 'CNB', scheduledArrival: new Date(Date.now() + 20 * 3_600_000) })

    await runTrainPollingTick()
    expect(await TrainStatus.countDocuments({ trainNo: '15565', serviceDate: tomorrow })).toBe(1)
    expect(await TrainStatus.countDocuments({ trainNo: '12555' })).toBe(0)
  })

  it('never refreshes a train once it has been confirmed arrived, however old the row gets', async () => {
    // Seen in production: trains that had already departed CNB were still
    // being re-polled every 15 minutes because the tick only ever asked
    // "has enough time passed", never "is this train even still moving".
    // A row old enough to fail every tier must still be left untouched once
    // arrived is set, exactly as a provider would set it after a real
    // departure — this is the mechanism, not the provider, being tested.
    const veryOld = new Date(Date.now() - 999 * 60_000)
    await TrainStatus.updateOne(
      { trainNo: '12312' },
      { $set: { fetchedAt: veryOld, arrived: true } },
    )

    await runTrainPollingTick()

    const row = await TrainStatus.findOne({ trainNo: '12312' })
    // Untouched fetchedAt is the proof: no upstream call was made for it.
    expect(row!.fetchedAt.getTime()).toBe(veryOld.getTime())
  })
})
