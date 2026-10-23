import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { disconnectDb } from '../src/lib/db'
import { Order } from '../src/lib/models'
import { findById, recentCancellations } from '../src/lib/repo/orderRepo'
import { correctRiderOutcome, transitionOrder } from '../src/lib/repo/transitionOrder'
import { lastSettlementFor, pendingCashFor, settleRiderCash } from '../src/lib/repo/riderCashRepo'
import { ConflictError, ForbiddenError, NotFoundError, type AuthContext } from '../src/lib/authContext'
import { issueMobileToken } from '../src/lib/mobile/token'
import { GET as getHistory } from '../src/app/api/mobile/history/route'
import { POST as postMutations } from '../src/app/api/mobile/mutations/route'
import { maskPhone, RIDER_CORRECTION_WINDOW_MS } from '../src/lib/riderRecords'
import { todayIST } from '../src/lib/format'
import { assignRider, ctxFor, makeOrder, makeRestaurant, makeUser, resetDb } from './fixtures'

type Id = mongoose.Types.ObjectId

describe('maskPhone', () => {
  it('keeps the first and last three digits of the ten-digit number', () => {
    expect(maskPhone('9876543210')).toBe('987••••210')
  })
  it('drops a +91 or leading 0 before counting', () => {
    expect(maskPhone('+91 98765 43210')).toBe('987••••210')
    expect(maskPhone('09876543210')).toBe('987••••210')
  })
  it('leaves nothing to read in a short number, and null stays null', () => {
    expect(maskPhone('12345')).toBe('•••••')
    expect(maskPhone(null)).toBeNull()
  })
})

describe('rider self-service: pickup, correction, cash', () => {
  let outlet: Id
  let manager: AuthContext
  let otherManager: AuthContext
  let telecaller: AuthContext
  let riderA: AuthContext
  let riderB: AuthContext
  let riderAId: Id
  let riderBId: Id
  let tokenA: string

  const ready = (extra: Record<string, unknown> = {}) =>
    makeOrder({ restaurantId: outlet, status: 'PREPARED', serviceDate: todayIST(), trainNo: '12506', ...extra })

  /** Ready → picked up → delivered by `rider`, with the bill collected. */
  async function delivered(rider: AuthContext, extra: Record<string, unknown> = {}) {
    const o = await ready(extra)
    await transitionOrder({ ctx: rider, orderId: String(o._id), to: 'DISPATCHED' })
    await transitionOrder({
      ctx: rider, orderId: String(o._id), to: 'DELIVERED',
      apply: { amountCollectedPaise: (extra.amountPaise as number | undefined) ?? 12000 },
    })
    return String(o._id)
  }

  beforeAll(async () => {
    await resetDb()
    outlet = (await makeRestaurant('HOTEL GANGA GALAXY', 'CNB'))._id
    const elsewhere = (await makeRestaurant('SHREE ANNAPURNA', 'PRYJ'))._id
    manager = ctxFor(await makeUser('STORE_MANAGER', '9400000001', outlet))
    otherManager = ctxFor(await makeUser('STORE_MANAGER', '9400000002', elsewhere))
    telecaller = ctxFor(await makeUser('TELECALLER', '9400000003', outlet))
    const a = await makeUser('DELIVERY_AGENT', '9400000004', outlet)
    const b = await makeUser('DELIVERY_AGENT', '9400000005', outlet)
    riderA = ctxFor(a)
    riderB = ctxFor(b)
    riderAId = a._id
    riderBId = b._id
    tokenA = issueMobileToken(a).token
  })

  afterAll(async () => {
    await disconnectDb()
  })

  // --- pickup off the counter ---------------------------------------------

  it('a ready order nobody was given is open to every rider at the outlet; cooking ones are not', async () => {
    const cooking = await makeOrder({ restaurantId: outlet, status: 'KOT_PRINTED' })
    const open = await ready()
    expect(await findById(riderA, String(cooking._id))).toBeNull()
    expect(await findById(riderA, String(open._id))).not.toBeNull()
    expect(await findById(riderB, String(open._id))).not.toBeNull()
  })

  it('the first rider to pick it up takes it, and it vanishes for everyone else', async () => {
    const open = await ready()
    await transitionOrder({ ctx: riderA, orderId: String(open._id), to: 'DISPATCHED' })
    expect((await findById(riderA, String(open._id)))!.delivery.agentIds.map(String)).toEqual([String(riderAId)])
    expect(await findById(riderB, String(open._id))).toBeNull()
    await expect(
      transitionOrder({ ctx: riderB, orderId: String(open._id), to: 'DISPATCHED' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('a ready order the office gave to someone else is not open', async () => {
    const theirs = await ready()
    await assignRider(theirs._id, riderBId)
    expect(await findById(riderA, String(theirs._id))).toBeNull()
  })

  it('the queue tells a rider who lost the race, and drops the pickup', async () => {
    const open = await ready()
    await transitionOrder({ ctx: riderB, orderId: String(open._id), to: 'DISPATCHED' })
    const res = await postMutations(new Request('http://localhost/api/mobile/mutations', {
      method: 'POST',
      headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' },
      body: JSON.stringify({ mutations: [{ kind: 'DISPATCH_ORDER', clientId: 'c1', orderId: String(open._id) }] }),
    }))
    const body = await res.json()
    expect(body.results[0]).toMatchObject({ applied: false, retryable: false })
    expect(body.results[0].error).toMatch(/another rider/i)
  })

  it('putting back a self-picked order frees it for others; an office-assigned one stays with the rider', async () => {
    const open = await ready()
    await transitionOrder({ ctx: riderA, orderId: String(open._id), to: 'DISPATCHED' })
    await transitionOrder({ ctx: riderA, orderId: String(open._id), to: 'PREPARED' })
    expect(await findById(riderB, String(open._id))).not.toBeNull()

    const given = await ready()
    await Order.updateOne({ _id: given._id }, { 'delivery.agentIds': [riderAId], 'delivery.assignedAt': new Date() })
    await transitionOrder({ ctx: riderA, orderId: String(given._id), to: 'DISPATCHED' })
    await transitionOrder({ ctx: riderA, orderId: String(given._id), to: 'PREPARED' })
    expect(await findById(riderB, String(given._id))).toBeNull()
    expect(await findById(riderA, String(given._id))).not.toBeNull()
  })

  // --- 30-hour correction ---------------------------------------------------

  it('a rider can flip delivered to not delivered, which clears the cash, and back', async () => {
    const id = await delivered(riderA)
    const closedAt = (await findById(riderA, id))!.delivery.closedAt
    expect(closedAt).toBeInstanceOf(Date)

    await correctRiderOutcome({ ctx: riderA, orderId: id, from: 'DELIVERED', to: 'FAILED', reason: 'Wrong berth' })
    let o = (await findById(riderA, id))!
    expect(o.status).toBe('FAILED')
    expect(o.delivery.amountCollectedPaise).toBeNull()
    expect(o.delivery.failureReason).toBe('Wrong berth')

    await correctRiderOutcome({ ctx: riderA, orderId: id, from: 'FAILED', to: 'DELIVERED' })
    o = (await findById(riderA, id))!
    expect(o.status).toBe('DELIVERED')
    expect(o.delivery.amountCollectedPaise).toBe(12000)
    // The window is measured from the first close, never restarted.
    expect(o.delivery.closedAt!.getTime()).toBe(closedAt!.getTime())
    expect(o.events.at(-1)!.meta).toMatchObject({ via: 'rider-correction' })
  })

  it('a rider can cancel within the window, and undo only their own cancel', async () => {
    const id = await delivered(riderA)
    await expect(
      correctRiderOutcome({ ctx: riderA, orderId: id, from: 'DELIVERED', to: 'CANCELLED' }),
    ).rejects.toBeInstanceOf(ConflictError)
    await correctRiderOutcome({ ctx: riderA, orderId: id, from: 'DELIVERED', to: 'CANCELLED', reason: 'Passenger refused' })
    await correctRiderOutcome({ ctx: riderA, orderId: id, from: 'CANCELLED', to: 'DELIVERED' })
    expect((await findById(riderA, id))!.status).toBe('DELIVERED')

    // A rider's own cancel is a correction of the record, not a kitchen alert.
    await correctRiderOutcome({ ctx: riderA, orderId: id, from: 'DELIVERED', to: 'CANCELLED', reason: 'Refused' })
    const alerts = await recentCancellations(manager, { serviceDate: todayIST(), since: new Date(Date.now() - 60_000) })
    expect(alerts.map((a) => a.id)).not.toContain(id)
  })

  it('an office cancellation is not the rider\'s to undo', async () => {
    const o = await ready()
    await transitionOrder({ ctx: riderA, orderId: String(o._id), to: 'DISPATCHED' })
    await transitionOrder({ ctx: telecaller, orderId: String(o._id), to: 'CANCELLED' })
    await expect(
      correctRiderOutcome({ ctx: riderA, orderId: String(o._id), from: 'CANCELLED', to: 'DELIVERED' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('closes after 30 hours', async () => {
    const id = await delivered(riderA)
    await expect(
      correctRiderOutcome({
        ctx: riderA, orderId: id, from: 'DELIVERED', to: 'FAILED', reason: 'x',
        now: new Date(Date.now() + RIDER_CORRECTION_WINDOW_MS + 60_000),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('a stale correction loses instead of overwriting, and another rider cannot touch it', async () => {
    const id = await delivered(riderA)
    await expect(
      correctRiderOutcome({ ctx: riderA, orderId: id, from: 'FAILED', to: 'CANCELLED', reason: 'x' }),
    ).rejects.toBeInstanceOf(ConflictError)
    await expect(
      correctRiderOutcome({ ctx: riderB, orderId: id, from: 'DELIVERED', to: 'FAILED', reason: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      correctRiderOutcome({ ctx: manager, orderId: id, from: 'DELIVERED', to: 'FAILED', reason: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  // --- cash ------------------------------------------------------------------

  it('the wallet counts delivered COD the rider holds, once per order, and not prepaid', async () => {
    await Order.updateMany({}, { $set: { 'delivery.codSettledAt': new Date(0) } })
    await delivered(riderB, { amountPaise: 30000 })
    await delivered(riderB, { amountPaise: 20000, paymentMode: 'PREPAID' })

    // A bulk order carried by two riders: the cash is the one who delivered it.
    const bulk = await ready({ amountPaise: 50000 })
    await Order.updateOne({ _id: bulk._id }, { 'delivery.agentIds': [riderAId, riderBId] })
    await transitionOrder({ ctx: riderB, orderId: String(bulk._id), to: 'DISPATCHED' })
    await transitionOrder({ ctx: riderB, orderId: String(bulk._id), to: 'DELIVERED', apply: { amountCollectedPaise: 50000 } })

    expect(await pendingCashFor(riderB, riderBId)).toMatchObject({ paise: 80000, orders: 2 })
    expect(await pendingCashFor(riderA, riderAId)).toMatchObject({ paise: 0, orders: 0 })
  })

  it('a store manager collects exactly what they were shown, and the wallet goes to zero', async () => {
    const shown = await pendingCashFor(manager, riderBId)
    // A delivery lands after the page loaded: it must not be swept up.
    const late = await delivered(riderB, { amountPaise: 9000 })

    await expect(
      settleRiderCash({ ctx: otherManager, riderId: String(riderBId), orderIds: shown.orderIds }),
    ).rejects.toBeInstanceOf(ConflictError)
    await expect(
      settleRiderCash({ ctx: riderB, riderId: String(riderBId), orderIds: shown.orderIds }),
    ).rejects.toBeInstanceOf(ForbiddenError)

    const r = await settleRiderCash({ ctx: manager, riderId: String(riderBId), orderIds: shown.orderIds })
    expect(r).toEqual({ orders: 2, paise: 80000 })
    expect(await pendingCashFor(riderB, riderBId)).toMatchObject({ paise: 9000, orderIds: [late] })
    expect(await lastSettlementFor(riderB, riderBId)).toMatchObject({ paise: 80000, orders: 2 })

    await expect(
      settleRiderCash({ ctx: manager, riderId: String(riderBId), orderIds: shown.orderIds }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('once the cash is handed over the rider can no longer change the order', async () => {
    const id = await delivered(riderA)
    const { orderIds } = await pendingCashFor(manager, riderAId)
    await settleRiderCash({ ctx: manager, riderId: String(riderAId), orderIds })
    await expect(
      correctRiderOutcome({ ctx: riderA, orderId: id, from: 'DELIVERED', to: 'FAILED', reason: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  // --- history API --------------------------------------------------------------

  it('history shows the last 48 hours, masks numbers past 30 hours, and searches everything', async () => {
    const fresh = await delivered(riderA, { contactPhone: '9876543210', externalOrderId: 'FRESH-1' })
    const old = await delivered(riderA, { contactPhone: '9123456789', externalOrderId: 'OLD-1' })
    const ancient = await delivered(riderA, { contactPhone: '9000011111', externalOrderId: 'ANCIENT-1' })
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000)
    await Order.updateOne({ _id: old }, { 'delivery.closedAt': hoursAgo(31) })
    await Order.updateOne({ _id: ancient }, { 'delivery.closedAt': hoursAgo(24 * 5) })

    const get = async (qs = '?v=2') => (await getHistory(new Request(`http://localhost/api/mobile/history${qs}`, {
      headers: { authorization: `Bearer ${tokenA}` },
    }))).json()

    const recent = await get()
    const byId = new Map(recent.orders.map((o: { id: string }) => [o.id, o]))
    expect(byId.has(ancient)).toBe(false)
    expect(byId.get(fresh)).toMatchObject({ contactPhone: '9876543210', phoneMasked: false })
    expect((byId.get(fresh) as { editableUntil: string | null }).editableUntil).not.toBeNull()
    expect(byId.get(old)).toMatchObject({ contactPhone: '912••••789', phoneMasked: true, editableUntil: null })

    const day = new Date(Date.now() - 24 * 5 * 3600_000 + 5.5 * 3600_000).toISOString().slice(0, 10)
    const dated = await get(`?v=2&date=${day}`)
    expect(dated.orders.map((o: { id: string }) => o.id)).toContain(ancient)

    const found = await get('?v=2&q=ANCIENT')
    expect(found.orders.map((o: { id: string }) => o.id)).toEqual([ancient])
    const byPhone = await get('?v=2&q=90000 111')
    expect(byPhone.orders[0]).toMatchObject({ id: ancient, contactPhone: '900••••111' })

    // Older app builds draw any non-FAILED row as delivered: no cancellations for them.
    const cancelled = await delivered(riderA)
    await correctRiderOutcome({ ctx: riderA, orderId: cancelled, from: 'DELIVERED', to: 'CANCELLED', reason: 'Refused' })
    expect((await get()).orders.map((o: { id: string }) => o.id)).toContain(cancelled)
    expect((await get('')).orders.map((o: { id: string }) => o.id)).not.toContain(cancelled)

    expect((await getHistory(new Request('http://localhost/api/mobile/history?date=nonsense', {
      headers: { authorization: `Bearer ${tokenA}` },
    }))).status).toBe(400)
  })
})
