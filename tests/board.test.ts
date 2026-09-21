import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { disconnectDb } from '../src/lib/db'
import { countOrders } from '../src/lib/repo/orderRepo'
import { loadRunBoard, liveFilter } from '../src/lib/board'
import { inRollover, liveServiceDates, REFRESH_SECONDS, ROLLOVER_HOUR_IST } from '../src/lib/liveDay'
import { callBoardRow } from '../src/lib/orderView'
import { shiftServiceDate, todayIST } from '../src/lib/format'
import type { AuthContext } from '../src/lib/authContext'
import { ctxFor, makeOrder, makeRestaurant, makeUser, resetDb } from './fixtures'

/** An IST wall-clock moment on a given service date. */
const ist = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`)

describe('liveServiceDates', () => {
  it('is just today outside the past-midnight window', () => {
    expect(liveServiceDates(ist('2026-09-22', '23:30'))).toEqual(['2026-09-22'])
    expect(liveServiceDates(ist('2026-09-22', '12:00'))).toEqual(['2026-09-22'])
  })

  it('keeps last night live once the calendar has rolled over', () => {
    // A 00:30 train belongs to yesterday's service date; at 00:31 its orders
    // are still open and must not drop off the board.
    expect(liveServiceDates(ist('2026-09-23', '00:00'))).toEqual(['2026-09-23', '2026-09-22'])
    expect(liveServiceDates(ist('2026-09-23', '00:31'))).toEqual(['2026-09-23', '2026-09-22'])
  })

  it('closes the window at the rollover hour, in IST and not UTC', () => {
    expect(ROLLOVER_HOUR_IST).toBe(6)
    expect(inRollover(ist('2026-09-23', '05:59'))).toBe(true)
    expect(inRollover(ist('2026-09-23', '06:00'))).toBe(false)
    // 20:00 UTC is 01:30 IST the next day: still inside the window.
    expect(liveServiceDates(new Date('2026-09-22T20:00:00Z'))).toEqual(['2026-09-23', '2026-09-22'])
  })

  it('has one refresh interval for every screen', () => {
    expect(REFRESH_SECONDS).toBe(30)
  })
})

describe('the live board, seen by each role', () => {
  let telecaller: AuthContext
  let manager: AuthContext
  let admin: AuthContext
  let ganga: import('mongoose').Types.ObjectId
  let annapurna: import('mongoose').Types.ObjectId
  const today = todayIST()
  const yesterday = shiftServiceDate(today, -1)

  beforeAll(async () => {
    await resetDb()
    ganga = (await makeRestaurant('HOTEL GANGA GALAXY', 'CNB'))._id
    annapurna = (await makeRestaurant('SHREE ANNAPURNA', 'PRYJ'))._id
    telecaller = ctxFor(await makeUser('TELECALLER', '9000000020', ganga))
    manager = ctxFor(await makeUser('STORE_MANAGER', '9000000021', ganga))
    admin = ctxFor(await makeUser('ADMIN', '9000000022'))

    const at = (hhmm: string) => ist(today, hhmm)
    await makeOrder({ restaurantId: ganga, stationCode: 'CNB', serviceDate: today, trainNo: '11111', trainName: 'Early Exp', scheduledArrival: at('23:50'), coach: 'B2' })
    await makeOrder({ restaurantId: ganga, stationCode: 'CNB', serviceDate: today, trainNo: '22222', trainName: 'Later Exp', scheduledArrival: at('23:58'), coach: 'A1' })
    await makeOrder({ restaurantId: annapurna, stationCode: 'PRYJ', serviceDate: today, trainNo: '33333', trainName: 'Elsewhere Exp', scheduledArrival: at('23:55') })
    // Finished orders are not part of what is live.
    await makeOrder({ restaurantId: ganga, stationCode: 'CNB', serviceDate: today, trainNo: '44444', status: 'DELIVERED', scheduledArrival: at('23:40') })
  })

  afterAll(async () => {
    await disconnectDb()
  })

  // Cache-only, as the call desk reads it: no provider is involved in a test.
  const board = (ctx: AuthContext) => loadRunBoard(ctx, 'today', { allowFetch: false })

  it('shows the store manager and the telecaller the same trains in the same order', async () => {
    const [m, t] = await Promise.all([board(manager), board(telecaller)])
    expect(t.runs.map((r) => r.key)).toEqual(m.runs.map((r) => r.key))
    expect(t.runs.map((r) => t.timingOf(r).effectiveArrival?.toISOString())).toEqual(
      m.runs.map((r) => m.timingOf(r).effectiveArrival?.toISOString()),
    )
    // Soonest arrival first, not booking order.
    expect(m.runs.map((r) => r.trainNo)).toEqual(['11111', '22222'])
  })

  it('shows an admin those same trains, in the same relative order, plus other outlets', async () => {
    const [m, a] = await Promise.all([board(manager), board(admin)])
    const managerKeys = new Set(m.runs.map((r) => r.key))
    expect(a.runs.filter((r) => managerKeys.has(r.key)).map((r) => r.key)).toEqual(m.runs.map((r) => r.key))
    expect(a.runs.map((r) => r.trainNo)).toContain('33333')
  })

  it("keeps the telecaller and the manager to their own outlets' trains", async () => {
    const [m, t] = await Promise.all([board(manager), board(telecaller)])
    for (const b of [m, t]) {
      expect(b.runs.map((r) => r.trainNo)).not.toContain('33333')
      expect(b.runs.flatMap((r) => r.orders).every((o) => String(o.restaurantId) === String(ganga))).toBe(true)
    }
  })

  it('leaves finished orders off the board and out of the count', async () => {
    const t = await board(telecaller)
    expect(t.runs.map((r) => r.trainNo)).not.toContain('44444')
    expect(await countOrders(telecaller, liveFilter())).toBe(2)
    expect(await countOrders(manager, liveFilter())).toBe(2)
    expect(await countOrders(admin, liveFilter())).toBe(3)
  })

  it("counts last night's open orders as live until the window closes, on every role's count", async () => {
    const stale = await makeOrder({
      restaurantId: ganga,
      stationCode: 'CNB',
      serviceDate: yesterday,
      trainNo: '55555',
      scheduledArrival: ist(today, '00:30'),
    })
    const before = { t: await countOrders(telecaller, liveFilter(ist(today, '07:00'))), a: await countOrders(admin, liveFilter(ist(today, '07:00'))) }
    const during = { t: await countOrders(telecaller, liveFilter(ist(today, '00:45'))), a: await countOrders(admin, liveFilter(ist(today, '00:45'))) }
    // One more order is live at 00:45 than at 07:00, for everyone alike.
    expect(during.t).toBe(before.t + 1)
    expect(during.a).toBe(before.a + 1)
    expect(String(stale._id)).toBeTruthy()
  })
})

describe('what the call board is given', () => {
  const order = {
    _id: 'abc123',
    externalOrderId: 'TEST-1',
    orderType: 'RETAIL',
    status: 'RECEIVED',
    coach: 'B2',
    berth: '14',
    contactName: 'Asha',
    contactPhone: '9000000001',
    paymentMode: 'COD',
    // Everything below is money or money-adjacent and must never come out.
    amountPaise: 45000,
    remark: 'Balance 450 pending',
    items: [
      { name: 'Veg Thali', qty: 2, isPacking: false, pricePaise: 12000 },
      { name: 'Carry bag', qty: 1, isPacking: true, pricePaise: 500 },
    ],
    callLog: [{ text: 'Will be at the door', userId: 'u1', createdAt: new Date('2026-09-22T09:00:00Z') }],
  }

  it('carries the payment mode and never an amount or a remark', () => {
    const row = callBoardRow(order as never, { outletName: null, actorName: new Map([['u1', 'Sneha']]) })
    expect(row.paymentMode).toBe('COD')

    const keys = Object.keys(row).sort()
    expect(keys).toEqual(
      [
        'id', 'externalOrderId', 'orderType', 'status', 'coach', 'berth', 'rawSeat', 'handoverPoint',
        'contactName', 'contactPhone', 'itemCount', 'itemSummary', 'paymentMode', 'outletName',
        'canCancel', 'callNoteCount', 'callNoteHint', 'lastCall',
      ].sort(),
    )
    const json = JSON.stringify(row)
    expect(json).not.toMatch(/amount|pricePaise|remark/i)
    expect(json).not.toContain('45000')
    expect(json).not.toContain('12000')
    expect(json).not.toContain('Balance 450')
  })

  it('leaves packing off the item list and names who made the last call', () => {
    const row = callBoardRow(order as never, { outletName: 'HOTEL GANGA GALAXY', actorName: new Map([['u1', 'Sneha']]) })
    expect(row.itemCount).toBe(1)
    expect(row.itemSummary).toBe('Veg Thali ×2')
    expect(row.outletName).toBe('HOTEL GANGA GALAXY')
    expect(row.lastCall).toMatchObject({ text: 'Will be at the door', by: 'Sneha' })
    expect(row.canCancel).toBe(true)
  })

  it('reports an order nobody has rung, and does not offer to cancel one already cancelled', () => {
    const fresh = callBoardRow({ ...order, callLog: undefined, status: 'CANCELLED' } as never, {
      outletName: null,
      actorName: new Map(),
    })
    expect(fresh.lastCall).toBeNull()
    expect(fresh.callNoteCount).toBe(0)
    expect(fresh.canCancel).toBe(false)
  })
})
