import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { disconnectDb } from '../src/lib/db'
import { Order, User } from '../src/lib/models'
import { findById } from '../src/lib/repo/orderRepo'
import {
  adminOverrideStatus, assignAgents, assignRiders, correctRiderOutcome, transitionOrder,
} from '../src/lib/repo/transitionOrder'
import { collectionHistory, pendingCashFor, settleRiderCash } from '../src/lib/repo/riderCashRepo'
import { riderDays, ridersDayTotal, opsSpan } from '../src/lib/repo/riderLedgerRepo'
import { andClause, riderClause } from '../src/lib/repo/riderFilter'
import { riderBoard } from '../src/lib/repo/riderLocationRepo'
import { markReturnedToOrigin } from '../src/lib/repo/rtoRepo'
import { setTeam, teamView } from '../src/lib/repo/teamRepo'
import { adminEditOrder } from '../src/lib/repo/adminEditOrder'
import { ConflictError, ForbiddenError, type AuthContext } from '../src/lib/authContext'
import { issueMobileToken } from '../src/lib/mobile/token'
import { GET as getHistory } from '../src/app/api/mobile/history/route'
import { GET as getRuns } from '../src/app/api/mobile/runs/route'
import { GET as getTeam, POST as postTeam } from '../src/app/api/mobile/team/route'
import { opsDayOf, opsDayRange } from '../src/lib/opsDay'
import { kitchenStatus, overallStatus, riderStatus } from '../src/lib/orderViews'
import { canReceiveCash } from '../src/lib/collections'
import { shiftServiceDate, todayIST } from '../src/lib/format'
import { ctxFor, makeOrder, makeRestaurant, makeUser, resetDb } from './fixtures'

type Id = mongoose.Types.ObjectId

describe('the 3am reporting day', () => {
  it('turns at 3 am IST, not at midnight', () => {
    expect(opsDayOf(new Date('2026-11-12T23:59:00+05:30'))).toBe('2026-11-12')
    // A late train delivered at 1:30 am is still the 12th's work.
    expect(opsDayOf(new Date('2026-11-13T01:30:00+05:30'))).toBe('2026-11-12')
    expect(opsDayOf(new Date('2026-11-13T02:59:59+05:30'))).toBe('2026-11-12')
    expect(opsDayOf(new Date('2026-11-13T03:00:00+05:30'))).toBe('2026-11-13')
  })

  it('is a 24 hour range that contains exactly its own instants', () => {
    const r = opsDayRange('2026-11-12')!
    expect(r.from.toISOString()).toBe(new Date('2026-11-12T03:00:00+05:30').toISOString())
    expect(r.to.getTime() - r.from.getTime()).toBe(24 * 3_600_000)
    expect(opsDayOf(r.from)).toBe('2026-11-12')
    expect(opsDayOf(new Date(r.to.getTime() - 1))).toBe('2026-11-12')
    expect(opsDayOf(r.to)).toBe('2026-11-13')
    expect(opsDayRange('nonsense')).toBeNull()
  })
})

describe('one order, three readings', () => {
  it('reports failed and missed deliveries as cancelled overall', () => {
    expect(overallStatus('DELIVERED')).toBe('DELIVERED')
    for (const s of ['FAILED', 'MISSED_DELIVERY', 'MISDELIVERY', 'CANCELLED', 'LOST', 'REFUNDED']) {
      expect(overallStatus(s)).toBe('CANCELLED')
    }
    for (const s of ['RECEIVED', 'ACCEPTED', 'KOT_PRINTED', 'PREPARED', 'DISPATCHED', 'REFUND_PENDING']) {
      expect(overallStatus(s)).toBe('PROCESSING')
    }
  })

  it('gives the rider an instruction and the kitchen a place', () => {
    expect(riderStatus({ status: 'KOT_PRINTED' })).toBe('NOT_READY')
    expect(riderStatus({ status: 'PREPARED' })).toBe('READY')
    expect(riderStatus({ status: 'DISPATCHED' })).toBe('PICKED_UP')
    expect(riderStatus({ status: 'FAILED' })).toBe('NOT_DELIVERED')
    // An open return outranks why it was opened: the bag has to come back.
    expect(riderStatus({ status: 'CANCELLED', delivery: { rto: { status: 'PENDING' } } })).toBe('RETURN_PENDING')
    expect(riderStatus({ status: 'FAILED', delivery: { rto: { status: 'RETURNED' } } })).toBe('RETURNED')
    expect(riderStatus({ status: 'CANCELLED' })).toBe('CANCELLED')

    expect(kitchenStatus({ status: 'KOT_PRINTED' })).toBe('COOKING')
    expect(kitchenStatus({ status: 'DISPATCHED' })).toBe('OUT')
    expect(kitchenStatus({ status: 'FAILED', delivery: { rto: { status: 'PENDING' } } })).toBe('RETURNING')
    expect(kitchenStatus({ status: 'DELIVERED' })).toBe('CLOSED')
  })
})

describe('who may receive cash', () => {
  it('is an admin always, a manager unless switched off, a team leader only when switched on', () => {
    expect(canReceiveCash({ role: 'ADMIN' })).toBe(true)
    expect(canReceiveCash({ role: 'STORE_MANAGER' })).toBe(true)
    expect(canReceiveCash({ role: 'STORE_MANAGER', canReceiveCash: false })).toBe(false)
    expect(canReceiveCash({ role: 'DELIVERY_AGENT', isTeamLead: true })).toBe(false)
    expect(canReceiveCash({ role: 'DELIVERY_AGENT', isTeamLead: true, canReceiveCash: true })).toBe(true)
    expect(canReceiveCash({ role: 'DELIVERY_AGENT', canReceiveCash: true })).toBe(false)
    expect(canReceiveCash({ role: 'TELECALLER', canReceiveCash: true })).toBe(false)
  })
})

describe('rider record: one source for the app and the office', () => {
  let outlet: Id
  let far: Id
  let admin: AuthContext
  let manager: AuthContext
  let telecaller: AuthContext
  let a: AuthContext
  let b: AuthContext
  let lead: AuthContext
  let aId: Id
  let bId: Id
  let leadId: Id
  let farRiderId: Id
  let managerId: Id
  let tokenA: string
  let tokenB: string
  let tokenLead: string

  const ready = (extra: Record<string, unknown> = {}) =>
    makeOrder({ restaurantId: outlet, status: 'PREPARED', serviceDate: todayIST(), trainNo: '12878', ...extra })
  const get = async (id: string) => (await Order.findById(id).lean())!
  const history = async (token: string, qs = '') =>
    (await getHistory(new Request(`http://localhost/api/mobile/history?v=3${qs}`, {
      headers: { authorization: `Bearer ${token}` },
    }))).json()

  beforeAll(async () => {
    await resetDb()
    outlet = (await makeRestaurant('HOTEL GANGA GALAXY', 'CNB'))._id
    far = (await makeRestaurant('SHREE ANNAPURNA', 'PRYJ'))._id
    admin = ctxFor(await makeUser('ADMIN', '9400000001'))
    const m = await makeUser('STORE_MANAGER', '9400000002', outlet)
    managerId = m._id
    manager = ctxFor(m)
    telecaller = ctxFor(await makeUser('TELECALLER', '9400000003', outlet))
    const ua = await makeUser('DELIVERY_AGENT', '9400000004', outlet)
    const ub = await makeUser('DELIVERY_AGENT', '9400000005', outlet)
    const ul = await makeUser('DELIVERY_AGENT', '9400000006', outlet)
    farRiderId = (await makeUser('DELIVERY_AGENT', '9400000007', far))._id
    aId = ua._id
    bId = ub._id
    leadId = ul._id
    a = ctxFor(ua)
    b = ctxFor(ub)
    lead = ctxFor(ul)
    tokenA = issueMobileToken(ua).token
    tokenB = issueMobileToken(ub).token
    tokenLead = issueMobileToken(ul).token
  })

  afterAll(async () => {
    await disconnectDb()
  })

  describe('an order offered to several riders', () => {
    it('is visible to each until one picks it up, then is theirs alone', async () => {
      const o = String((await ready())._id)
      await assignRiders({ ctx: manager, orderId: o, riderIds: [String(aId), String(bId)] })
      expect(await findById(a, o)).not.toBeNull()
      expect(await findById(b, o)).not.toBeNull()

      await transitionOrder({ ctx: a, orderId: o, to: 'DISPATCHED' })
      expect(String((await get(o)).delivery.pickedUpBy)).toBe(String(aId))
      expect(await findById(a, o)).not.toBeNull()
      // Gone from the other rider's list, and not theirs to close.
      expect(await findById(b, o)).toBeNull()
      await expect(transitionOrder({ ctx: b, orderId: o, to: 'DELIVERED' })).rejects.toThrow()

      await transitionOrder({ ctx: a, orderId: o, to: 'DELIVERED' })
      const mine = await history(tokenA)
      const theirs = await history(tokenB)
      expect(mine.orders.map((x: { id: string }) => x.id)).toContain(o)
      expect(theirs.orders.map((x: { id: string }) => x.id)).not.toContain(o)
    })

    it('comes back to everyone when the rider puts it back on the counter', async () => {
      const o = String((await ready())._id)
      await assignRiders({ ctx: manager, orderId: o, riderIds: [String(aId), String(bId)] })
      await transitionOrder({ ctx: a, orderId: o, to: 'DISPATCHED' })
      await transitionOrder({ ctx: a, orderId: o, to: 'PREPARED' })
      expect((await get(o)).delivery.pickedUpBy).toBeNull()
      expect(await findById(b, o)).not.toBeNull()
    })

    it('charges the cash to the rider who carried it when a telecaller closes it', async () => {
      const o = String((await ready({ amountPaise: 30000 }))._id)
      // B is offered it first and A second; A is the one who takes it.
      await assignRiders({ ctx: manager, orderId: o, riderIds: [String(bId), String(aId)] })
      await transitionOrder({ ctx: a, orderId: o, to: 'DISPATCHED' })
      await transitionOrder({ ctx: telecaller, orderId: o, to: 'DELIVERED' })
      const after = await get(o)
      expect(String(after.delivery.collectedBy)).toBe(String(aId))
      expect(after.delivery.amountCollectedPaise).toBe(30000)
    })

    it('hands over when the office reassigns it away from the carrier', async () => {
      const o = String((await ready())._id)
      await assignRiders({ ctx: manager, orderId: o, riderIds: [String(aId)] })
      await transitionOrder({ ctx: a, orderId: o, to: 'DISPATCHED' })
      await assignRiders({ ctx: manager, orderId: o, riderIds: [String(bId)] })
      // One rider named on an order already out: that rider has it now.
      expect(String((await get(o)).delivery.pickedUpBy)).toBe(String(bId))
      expect(await findById(a, o)).toBeNull()
      expect(await findById(b, o)).not.toBeNull()
    })
  })

  describe('orders that used to be missing for the assigned rider', () => {
    it('refuses an admin assigning a rider who does not work at the outlet', async () => {
      const o = String((await ready())._id)
      await expect(
        assignRiders({ ctx: admin, orderId: o, riderIds: [String(farRiderId)] }),
      ).rejects.toBeInstanceOf(ConflictError)
      await expect(
        assignAgents({ ctx: admin, orderId: o, agentIds: [String(farRiderId)] }),
      ).rejects.toBeInstanceOf(ConflictError)
    })

    it('shows the rider assigned work booked for yesterday and tomorrow, not only today', async () => {
      const today = todayIST()
      const ids: string[] = []
      for (const d of [-1, 0, 1]) {
        const o = String((await ready({ serviceDate: shiftServiceDate(today, d), trainNo: `1200${d + 2}` }))._id)
        await assignRiders({ ctx: manager, orderId: o, riderIds: [String(bId)] })
        ids.push(o)
      }
      // A bag in hand stays on the list however old its booking is.
      const old = String((await ready({ serviceDate: shiftServiceDate(today, -5), trainNo: '12999' }))._id)
      await assignRiders({ ctx: manager, orderId: old, riderIds: [String(bId)] })
      await transitionOrder({ ctx: b, orderId: old, to: 'DISPATCHED' })

      const res = await (await getRuns(new Request('http://localhost/api/mobile/runs', {
        headers: { authorization: `Bearer ${tokenB}` },
      }))).json()
      const shown = res.runs.flatMap((r: { orders: { id: string }[] }) => r.orders.map((x) => x.id))
      for (const id of [...ids, old]) expect(shown).toContain(id)
      const row = res.runs.flatMap((r: { orders: { id: string; riderStatus: string }[] }) => r.orders)
        .find((x: { id: string }) => x.id === old)
      expect(row.riderStatus).toBe('PICKED_UP')
    })
  })

  describe('cash on delivery', () => {
    it('fixes the amount at the door, so a later bill edit does not change what the rider owes', async () => {
      const o = String((await ready({ amountPaise: 21300 }))._id)
      await assignRiders({ ctx: manager, orderId: o, riderIds: [String(aId)] })
      await transitionOrder({ ctx: a, orderId: o, to: 'DISPATCHED' })
      // No amount typed: a COD delivery is taken as paid in full, and stored.
      await transitionOrder({ ctx: a, orderId: o, to: 'DELIVERED' })
      expect((await get(o)).delivery.amountCollectedPaise).toBe(21300)

      const before = await pendingCashFor(a, aId)
      await adminEditOrder(admin, o, { amountPaise: '999' })
      const after = await pendingCashFor(a, aId)
      expect(after.paise).toBe(before.paise)
    })

    it('records nothing collected on a prepaid delivery', async () => {
      const o = String((await ready({ paymentMode: 'PREPAID' }))._id)
      await assignRiders({ ctx: manager, orderId: o, riderIds: [String(aId)] })
      await transitionOrder({ ctx: a, orderId: o, to: 'DISPATCHED' })
      await transitionOrder({ ctx: a, orderId: o, to: 'DELIVERED' })
      expect((await get(o)).delivery.amountCollectedPaise).toBeNull()
    })
  })

  describe('a return that is open', () => {
    async function outWith(rider: AuthContext, riderId: Id) {
      const o = String((await ready())._id)
      await assignRiders({ ctx: manager, orderId: o, riderIds: [String(riderId)] })
      await transitionOrder({ ctx: rider, orderId: o, to: 'DISPATCHED' })
      return o
    }

    it('cannot be turned into a delivery by the rider when the office recorded the failure', async () => {
      const o = await outWith(a, aId)
      await transitionOrder({ ctx: telecaller, orderId: o, to: 'FAILED', apply: { failureReason: 'Passenger says no food came' } })
      expect((await get(o)).delivery.rto?.status).toBe('PENDING')

      await expect(
        correctRiderOutcome({ ctx: a, orderId: o, from: 'FAILED', to: 'DELIVERED' }),
      ).rejects.toBeInstanceOf(ForbiddenError)
      const after = await get(o)
      expect(after.status).toBe('FAILED')
      expect(after.delivery.rto?.status).toBe('PENDING')
      // And the app does not offer the change in the first place.
      const row = (await history(tokenA)).orders.find((x: { id: string }) => x.id === o)
      expect(row.editableUntil).toBeNull()
      expect(row.riderStatus).toBe('RETURN_PENDING')
    })

    it('can still be corrected by the rider who mistapped it themselves', async () => {
      const o = await outWith(a, aId)
      await transitionOrder({ ctx: a, orderId: o, to: 'FAILED', apply: { failureReason: 'wrong button' } })
      const out = await correctRiderOutcome({ ctx: a, orderId: o, from: 'FAILED', to: 'DELIVERED' })
      expect(out.status).toBe('DELIVERED')
      expect(out.delivery.rto).toBeNull()
    })

    it('cannot be overridden to delivered once the outlet has the bag back', async () => {
      const o = await outWith(a, aId)
      await transitionOrder({ ctx: a, orderId: o, to: 'FAILED', apply: { failureReason: 'not at seat' } })
      await markReturnedToOrigin({ ctx: admin, orderId: o })
      await expect(adminOverrideStatus({ ctx: admin, orderId: o, to: 'DELIVERED' })).rejects.toBeInstanceOf(ConflictError)
      expect((await get(o)).status).toBe('FAILED')
    })
  })

  describe('an admin override does what the status means', () => {
    it('opens a return when it cancels an order that is with a rider', async () => {
      const o = String((await ready())._id)
      await assignRiders({ ctx: manager, orderId: o, riderIds: [String(aId)] })
      await transitionOrder({ ctx: a, orderId: o, to: 'DISPATCHED' })
      const out = await adminOverrideStatus({ ctx: admin, orderId: o, to: 'CANCELLED' })
      expect(out.delivery.rto?.status).toBe('PENDING')
      expect(out.delivery.closedAt).toBeInstanceOf(Date)
    })

    it('records a delivery in full when it marks one', async () => {
      const o = String((await ready({ amountPaise: 15000 }))._id)
      await assignRiders({ ctx: manager, orderId: o, riderIds: [String(aId)] })
      await transitionOrder({ ctx: a, orderId: o, to: 'DISPATCHED' })
      const out = await adminOverrideStatus({ ctx: admin, orderId: o, to: 'DELIVERED' })
      expect(out.delivery.deliveredAt).toBeInstanceOf(Date)
      expect(String(out.delivery.collectedBy)).toBe(String(aId))
      expect(out.delivery.amountCollectedPaise).toBe(15000)
    })

    it('will not un-deliver an order whose cash has been received', async () => {
      const o = String((await ready())._id)
      await assignRiders({ ctx: manager, orderId: o, riderIds: [String(bId)] })
      await transitionOrder({ ctx: b, orderId: o, to: 'DISPATCHED' })
      await transitionOrder({ ctx: b, orderId: o, to: 'DELIVERED' })
      await settleRiderCash({ ctx: manager, riderId: String(bId), orderIds: [o] })
      await expect(adminOverrideStatus({ ctx: admin, orderId: o, to: 'FAILED' })).rejects.toBeInstanceOf(ConflictError)
    })

    it('still accepts a custom status, and leaves the record alone', async () => {
      const o = String((await ready())._id)
      const out = await adminOverrideStatus({ ctx: admin, orderId: o, to: 'REFUND_PENDING' })
      expect(out.status).toBe('REFUND_PENDING')
      expect(out.delivery.closedAt ?? null).toBeNull()
    })
  })

  describe('the same day, counted the same way everywhere', () => {
    it('puts a delivery made after midnight in the reporting day the shift began in', async () => {
      const c = await makeUser('DELIVERY_AGENT', '9400000020', outlet)
      const tokenC = issueMobileToken(c).token
      const make = (serviceDate: string, closedAt: string, extra: Record<string, unknown> = {}) =>
        makeOrder({
          restaurantId: outlet,
          serviceDate,
          status: 'DELIVERED',
          paymentMode: 'COD',
          amountPaise: 10000,
          ...extra,
          delivery: {
            agentIds: [c._id], pickedUpBy: c._id, collectedBy: c._id, amountCollectedPaise: 10000,
            dispatchedAt: new Date(closedAt), deliveredAt: new Date(closedAt), closedAt: new Date(closedAt),
            ...((extra.delivery as object) ?? {}),
          },
        })
      // Booked for the 11th, delivered on the 12th's shift: the 12th's work.
      await make('2026-10-11', '2026-10-12T04:10:00+05:30')
      // Booked for the 12th, delivered at 1:30 am on the 13th: still the 12th.
      await make('2026-10-12', '2026-10-13T01:30:00+05:30')
      // Booked for the 12th, delivered at noon: the plain case.
      await make('2026-10-12', '2026-10-12T12:00:00+05:30', { paymentMode: 'PREPAID' })
      // Booked for the 12th, but finished at 2 am on the 12th: the 11th's shift.
      await make('2026-10-12', '2026-10-12T02:00:00+05:30')
      // Not delivered: no cash, whatever the bill says.
      await make('2026-10-12', '2026-10-12T15:00:00+05:30', {
        status: 'FAILED',
        delivery: { deliveredAt: null, amountCollectedPaise: null, collectedBy: null },
      })

      const app = await history(tokenC, '&date=2026-10-12')
      expect(app.orders).toHaveLength(4)
      expect(app.summary).toMatchObject({
        done: 4, delivered: 3, notDelivered: 1, codOrders: 2, codPaise: 20000, prepaidOrders: 1,
      })

      // The office's board for the same day says exactly the same.
      const board = await riderBoard(admin, { serviceDate: '2026-10-12', now: new Date('2026-10-20T12:00:00+05:30') })
      const row = board.riders.find((r) => r.id === String(c._id))!
      expect(row.work).toMatchObject({
        done: app.summary.done,
        delivered: app.summary.delivered,
        failed: app.summary.notDelivered + app.summary.cancelled,
        codOrders: app.summary.codOrders,
        codPaise: app.summary.codPaise,
      })

      // And so does the ledger read directly, for the neighbouring day too.
      const eleventh = (await riderDays(admin, [c._id], opsSpan('2026-10-11', '2026-10-11'))).get(String(c._id))
      expect(eleventh).toMatchObject({ done: 1, delivered: 1, codPaise: 10000 })
    })
  })

  describe('teams and collections', () => {
    it('lets only an admin arrange teams, one level deep', async () => {
      await User.updateOne({ _id: leadId }, { $set: { isTeamLead: true } })
      await expect(setTeam({ ctx: manager, riderIds: [String(aId)], leadId: String(leadId) })).rejects.toBeInstanceOf(ForbiddenError)
      await expect(setTeam({ ctx: admin, riderIds: [String(aId)], leadId: String(bId) })).rejects.toBeInstanceOf(ConflictError)
      await expect(setTeam({ ctx: admin, riderIds: [String(leadId)], leadId: String(leadId) })).rejects.toBeInstanceOf(ConflictError)
      const r = await setTeam({ ctx: admin, riderIds: [String(aId)], leadId: String(leadId) })
      expect(r.moved).toBe(1)
    })

    it('shows a team leader their riders, and nobody else theirs', async () => {
      const team = await teamView(lead, leadId)
      expect(team.members.map((m) => m.id).sort()).toEqual([String(aId), String(leadId)].sort())
      expect(team.lead.canReceiveCash).toBe(false)
      await expect(teamView(a, leadId)).rejects.toBeInstanceOf(ForbiddenError)

      const notALead = await getTeam(new Request('http://localhost/api/mobile/team', {
        headers: { authorization: `Bearer ${tokenA}` },
      }))
      expect(notALead.status).toBe(403)
      const mine = await getTeam(new Request('http://localhost/api/mobile/team', {
        headers: { authorization: `Bearer ${tokenLead}` },
      }))
      expect(mine.status).toBe(200)
    })

    it('lets a team leader receive cash only once an admin allows it, and only from their team', async () => {
      const cash = async (rider: AuthContext, riderId: Id) => {
        const o = String((await ready({ amountPaise: 20000 }))._id)
        await assignRiders({ ctx: manager, orderId: o, riderIds: [String(riderId)] })
        await transitionOrder({ ctx: rider, orderId: o, to: 'DISPATCHED' })
        await transitionOrder({ ctx: rider, orderId: o, to: 'DELIVERED' })
        return o
      }
      const mine = await cash(a, aId)
      const theirs = await cash(b, bId)
      const post = (riderId: Id, orderIds: string[]) =>
        postTeam(new Request('http://localhost/api/mobile/team', {
          method: 'POST',
          headers: { authorization: `Bearer ${tokenLead}`, 'content-type': 'application/json' },
          body: JSON.stringify({ riderId: String(riderId), orderIds }),
        }))

      expect((await post(aId, [mine])).status).toBe(403)
      await User.updateOne({ _id: leadId }, { $set: { canReceiveCash: true } })
      // B is not on this leader's team.
      expect((await post(bId, [theirs])).status).toBe(403)
      // Nobody receives their own cash.
      await expect(settleRiderCash({ ctx: lead, riderId: String(leadId), orderIds: [mine] })).rejects.toBeInstanceOf(ForbiddenError)

      const due = await pendingCashFor(a, aId)
      const ok = await post(aId, due.orderIds)
      expect(ok.status).toBe(200)
      expect((await pendingCashFor(a, aId)).paise).toBe(0)

      // The handover reads back as one collection, received by the leader,
      // and the rider sees who took it.
      const [latest] = await collectionHistory(admin, [aId])
      expect(latest.receivedById).toBe(String(leadId))
      expect(latest.paise).toBe(due.paise)
      expect(latest.orders).toBe(due.orders)
      const seen = await history(tokenA)
      expect(seen.collections[0]).toMatchObject({ paise: due.paise, receivedAs: 'Team leader' })
      expect(seen.wallet.pendingPaise).toBe(0)
    })

    it('stops a store manager an admin has switched off', async () => {
      const o = String((await ready())._id)
      await assignRiders({ ctx: manager, orderId: o, riderIds: [String(bId)] })
      await transitionOrder({ ctx: b, orderId: o, to: 'DISPATCHED' })
      await transitionOrder({ ctx: b, orderId: o, to: 'DELIVERED' })
      await User.updateOne({ _id: managerId }, { $set: { canReceiveCash: false } })
      await expect(
        settleRiderCash({ ctx: manager, riderId: String(bId), orderIds: [o] }),
      ).rejects.toBeInstanceOf(ForbiddenError)
      await User.updateOne({ _id: managerId }, { $set: { canReceiveCash: true } })
      const r = await settleRiderCash({ ctx: manager, riderId: String(bId), orderIds: [o] })
      expect(r.orders).toBe(1)
    })
  })

  describe('a closed order belongs to one rider', () => {
    const pair = async (n: number) => {
      const x = await makeUser('DELIVERY_AGENT', `94100000${n}1`, outlet)
      const y = await makeUser('DELIVERY_AGENT', `94100000${n}2`, outlet)
      return { x, y, cx: ctxFor(x), cy: ctxFor(y) }
    }
    const today = () => opsDayRange(opsDayOf())!

    it('is counted once when the office closes it without a pickup', async () => {
      const { x, y } = await pair(1)
      const o = String((await ready({ amountPaise: 50000 }))._id)
      await assignRiders({ ctx: manager, orderId: o, riderIds: [String(x._id), String(y._id)] })
      await transitionOrder({ ctx: telecaller, orderId: o, to: 'DELIVERED' })

      // The rider charged with the cash is the rider whose delivery it is.
      const after = await get(o)
      expect(String(after.delivery.collectedBy)).toBe(String(x._id))
      expect(String(after.delivery.pickedUpBy)).toBe(String(x._id))

      const days = await riderDays(admin, [x._id, y._id], today())
      expect(days.get(String(x._id))).toMatchObject({ delivered: 1, codPaise: 50000 })
      expect(days.get(String(y._id))).toBeUndefined()
      // The riders' rows add up to the headline.
      expect(await ridersDayTotal(admin, [x._id, y._id], today())).toMatchObject({ delivered: 1, codPaise: 50000 })
      expect((await history(issueMobileToken(y).token)).orders).toHaveLength(0)
    })

    it('is counted once for an older order with no carrier or cash holder recorded', async () => {
      const { x, y } = await pair(2)
      const at = new Date()
      await makeOrder({
        restaurantId: outlet, status: 'FAILED', serviceDate: todayIST(),
        delivery: { agentIds: [x._id, y._id], dispatchedAt: at, closedAt: at },
      })
      const days = await riderDays(admin, [x._id, y._id], today())
      expect(days.get(String(x._id))).toMatchObject({ done: 1, notDelivered: 1 })
      expect(days.get(String(y._id))).toBeUndefined()
      expect((await history(issueMobileToken(x).token)).orders).toHaveLength(1)
      expect((await history(issueMobileToken(y).token)).orders).toHaveLength(0)
    })

    it('goes to whoever closes it after a mid-run handover to several riders', async () => {
      const { x, y, cy } = await pair(3)
      const o = String((await ready())._id)
      await assignRiders({ ctx: manager, orderId: o, riderIds: [String(aId)] })
      await transitionOrder({ ctx: a, orderId: o, to: 'DISPATCHED' })
      await assignRiders({ ctx: manager, orderId: o, riderIds: [String(x._id), String(y._id)] })
      expect((await get(o)).delivery.pickedUpBy).toBeNull()

      await transitionOrder({ ctx: cy, orderId: o, to: 'DELIVERED' })
      const after = await get(o)
      expect(String(after.delivery.pickedUpBy)).toBe(String(y._id))
      expect(String(after.delivery.collectedBy)).toBe(String(y._id))
      const days = await riderDays(admin, [x._id, y._id], today())
      expect(days.get(String(y._id))).toMatchObject({ delivered: 1 })
      expect(days.get(String(x._id))).toBeUndefined()
    })

    it('is nobody\'s work when it is cancelled after being put back on the counter', async () => {
      const { x, y, cx } = await pair(4)
      const o = String((await ready())._id)
      await assignRiders({ ctx: manager, orderId: o, riderIds: [String(x._id), String(y._id)] })
      await transitionOrder({ ctx: cx, orderId: o, to: 'DISPATCHED' })
      await transitionOrder({ ctx: cx, orderId: o, to: 'PREPARED' })
      expect((await get(o)).delivery.dispatchedAt).toBeNull()
      await transitionOrder({ ctx: telecaller, orderId: o, to: 'CANCELLED' })
      const days = await riderDays(admin, [x._id, y._id], today())
      expect(days.size).toBe(0)
    })
  })

  describe('an order an admin puts back in play', () => {
    it('drops its old close time and its old return, and closes afresh', async () => {
      const o = String((await ready({ amountPaise: 80000 }))._id)
      await assignRiders({ ctx: manager, orderId: o, riderIds: [String(aId)] })
      await transitionOrder({ ctx: a, orderId: o, to: 'DISPATCHED' })
      await transitionOrder({ ctx: a, orderId: o, to: 'FAILED', apply: { failureReason: 'train left' } })
      // As if that happened on an earlier day.
      const earlier = new Date(Date.now() - 3 * 86_400_000)
      await Order.updateOne({ _id: o }, { $set: { 'delivery.closedAt': earlier } })

      const reopened = await adminOverrideStatus({ ctx: admin, orderId: o, to: 'DISPATCHED' })
      expect(reopened.delivery.closedAt).toBeNull()
      expect(reopened.delivery.rto).toBeNull()
      expect(reopened.delivery.failureReason).toBeNull()
      expect(String(reopened.delivery.pickedUpBy)).toBe(String(aId))

      await transitionOrder({ ctx: a, orderId: o, to: 'DELIVERED' })
      const after = await get(o)
      expect(after.delivery.rto).toBeNull()
      // Counted on the day it was really delivered.
      expect(opsDayOf(after.delivery.closedAt!)).toBe(opsDayOf())
    })

    it('goes back to every rider it was offered to when overridden to ready', async () => {
      const o = String((await ready())._id)
      await assignRiders({ ctx: manager, orderId: o, riderIds: [String(aId), String(bId)] })
      await transitionOrder({ ctx: a, orderId: o, to: 'DISPATCHED' })
      expect(await findById(b, o)).toBeNull()
      const back = await adminOverrideStatus({ ctx: admin, orderId: o, to: 'PREPARED' })
      expect(back.delivery.pickedUpBy).toBeNull()
      expect(back.delivery.dispatchedAt).toBeNull()
      expect(back.delivery.rto ?? null).toBeNull()
      expect(await findById(b, o)).not.toBeNull()
    })
  })

  describe('reading the records', () => {
    it('keeps the rider filter when a search is added to it', async () => {
      const filter: Record<string, unknown> = { serviceDate: todayIST() }
      andClause(filter, riderClause(String(aId)))
      andClause(filter, { $or: [{ trainNo: '12878' }] })
      andClause(filter, null)
      expect(filter.$and).toHaveLength(2)
      expect(filter.$or).toBeUndefined()
      const found = await Order.find(filter).select('delivery.pickedUpBy delivery.agentIds').lean()
      expect(found.length).toBeGreaterThan(0)
      for (const f of found) {
        const mine = String(f.delivery?.pickedUpBy ?? '') === String(aId) ||
          (!f.delivery?.pickedUpBy && (f.delivery?.agentIds ?? []).map(String).includes(String(aId)))
        expect(mine).toBe(true)
      }
    })

    it('finds each rider\'s latest handover however many newer ones others have made', async () => {
      const c = await makeUser('DELIVERY_AGENT', '9410000091', outlet)
      const old = new Date(Date.now() - 20 * 86_400_000)
      await makeOrder({
        restaurantId: outlet, status: 'DELIVERED', paymentMode: 'COD', amountPaise: 12300,
        delivery: {
          agentIds: [c._id], pickedUpBy: c._id, collectedBy: c._id, amountCollectedPaise: 12300,
          deliveredAt: old, closedAt: old, codSettledAt: old, codSettledBy: managerId,
        },
      })
      // The newest handover overall belongs to someone else, and a limit of
      // one would return only that.
      const capped = await collectionHistory(admin, [aId, bId, c._id], { limit: 1 })
      expect(capped.map((x) => x.riderId)).not.toContain(String(c._id))
      const latest = await collectionHistory(admin, [aId, bId, c._id], { latestPerRider: true })
      const mine = latest.filter((x) => x.riderId === String(c._id))
      expect(mine).toHaveLength(1)
      expect(mine[0].paise).toBe(12300)
      expect(new Set(latest.map((x) => x.riderId)).size).toBe(latest.length)
    })
  })
})
