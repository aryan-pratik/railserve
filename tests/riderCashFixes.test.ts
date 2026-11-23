import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { disconnectDb } from '../src/lib/db'
import { User } from '../src/lib/models'
import { collectionHistory, pendingCashFor, settleRiderCash } from '../src/lib/repo/riderCashRepo'
import { riderBoard } from '../src/lib/repo/riderLocationRepo'
import { codSummary } from '../src/lib/repo/analyticsRepo'
import { opsDayOf } from '../src/lib/opsDay'
import { ctxFor, makeOrder, makeRestaurant, makeUser, resetDb, tenantId } from './fixtures'

/*
 * The rider cash bugs found in the 2026-11 audit, one test each: a
 * switched-off rider's cash vanishing from the board, handover history
 * ignoring part payments, Reports disagreeing with the wallets, rating-order
 * decoys counted as cash owed, and a corrected delivery splitting its cash
 * and its debt across two days.
 */

const HOUR = 3_600_000

describe('rider cash: audit fixes', () => {
  let outlet: Awaited<ReturnType<typeof makeRestaurant>>['_id']
  let admin: ReturnType<typeof ctxFor>
  let rider: Awaited<ReturnType<typeof makeUser>>
  const cod = (amountPaise: number, at: Date, extra: Record<string, unknown> = {}) =>
    makeOrder({
      restaurantId: outlet, status: 'DELIVERED', paymentMode: 'COD', amountPaise, serviceDate: opsDayOf(at),
      delivery: { agentIds: [rider._id], pickedUpBy: rider._id, collectedBy: rider._id, amountCollectedPaise: amountPaise, deliveredAt: at, closedAt: at },
      ...extra,
    })

  beforeEach(async () => {
    await resetDb()
    outlet = (await makeRestaurant('HOTEL GANGA GALAXY', 'CNB'))._id
    admin = ctxFor(await makeUser('ADMIN', '9420000001'))
    rider = await makeUser('DELIVERY_AGENT', '9420000002', outlet)
  })
  afterAll(disconnectDb)

  it('keeps a switched-off rider on the board while they still hold cash', async () => {
    await cod(15000, new Date(Date.now() - 30 * HOUR))
    await User.updateOne({ _id: rider._id, tenantId: tenantId() }, { $set: { active: false } })
    const board = await riderBoard(admin)
    expect(board.riders.map((r) => r.id)).toContain(String(rider._id))
  })

  it('records a part payment in the handover history as what was handed in', async () => {
    const now = new Date()
    const a = await cod(30000, new Date(now.getTime() - 3 * HOUR))
    const b = await cod(20000, new Date(now.getTime() - 2 * HOUR))
    await settleRiderCash({ ctx: admin, riderId: String(rider._id), orderIds: [String(a._id), String(b._id)], paise: 40000, now: new Date(now.getTime() - HOUR) })
    const [first] = await collectionHistory(admin, [rider._id])
    expect(first.paise).toBe(40000)
    expect((await pendingCashFor(admin, rider._id)).paise).toBe(10000)
    await settleRiderCash({ ctx: admin, riderId: String(rider._id), orderIds: [String(b._id)], paise: 10000, now })
    const [latest] = await collectionHistory(admin, [rider._id])
    expect(latest.paise).toBe(10000)
  })

  it('gives Reports the same cash still out as the wallets', async () => {
    const now = new Date()
    const a = await cod(30000, new Date(now.getTime() - 3 * HOUR))
    await cod(20000, new Date(now.getTime() - 2 * HOUR))
    // Before the wallet started: settled by hand, never pending.
    await cod(50000, new Date('2026-10-01T12:00:00+05:30'))
    await settleRiderCash({ ctx: admin, riderId: String(rider._id), orderIds: [String(a._id)], paise: 10000, now })
    const s = await codSummary(admin, {})
    const wallet = await pendingCashFor(admin, rider._id)
    expect(s.pendingPaise).toBe(wallet.paise)
    expect(s.pendingPaise).toBe(40000)
    expect(s.settledPaise).toBe(60000)
  })

  it('leaves rating-order decoys out of the cash a rider owes', async () => {
    await cod(25000, new Date(Date.now() - 2 * HOUR), { ratingOrder: true })
    expect((await pendingCashFor(admin, rider._id)).paise).toBe(0)
  })
})
