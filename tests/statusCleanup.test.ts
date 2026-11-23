import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Types } from 'mongoose'
import { disconnectDb } from '../src/lib/db'
import { Order } from '../src/lib/models'
import { cleanUpRetiredStatuses } from '../src/lib/repo/statusCleanup'
import { makeOrder, resetDb, tenantId } from './fixtures'

/*
 * The 2026-11 status clean-up: orders in a retired status get the status
 * that says what really happened, with the rest kept as a reason, a refund
 * or a tag. Runs at boot, so it must be safe to run twice.
 */

const ev = (fromStatus: string | null, toStatus: string) => ({ fromStatus, toStatus, userId: null, meta: {}, createdAt: new Date() })
const read = async (id: Types.ObjectId) => (await Order.findOne({ _id: id, tenantId: tenantId() }).lean())!

describe('cleanUpRetiredStatuses', () => {
  beforeEach(resetDb)
  afterAll(disconnectDb)

  it('turns misdelivery and missed delivery into not delivered, with the reason', async () => {
    const a = await makeOrder({ status: 'MISDELIVERY', events: [ev(null, 'RECEIVED'), ev('DISPATCHED', 'MISDELIVERY')] })
    const b = await makeOrder({ status: 'MISSED_DELIVERY', events: [ev(null, 'RECEIVED'), ev('DISPATCHED', 'MISSED_DELIVERY')] })
    const c = await makeOrder({ status: 'MISSED_DELEVERY', events: [ev(null, 'RECEIVED'), ev('RECEIVED', 'MISSED_DELEVERY')] })
    await cleanUpRetiredStatuses()
    expect(await read(a._id)).toMatchObject({ status: 'FAILED', delivery: { failureReason: 'WRONG_PASSENGER' } })
    expect(await read(b._id)).toMatchObject({ status: 'FAILED', delivery: { failureReason: 'MISSED_TRAIN' } })
    expect(await read(c._id)).toMatchObject({ status: 'FAILED', delivery: { failureReason: 'MISSED_TRAIN' } })
    // History is kept, with one line saying what changed.
    const events = (await read(b._id)).events
    expect(events.map((e) => e.toStatus)).toEqual(['RECEIVED', 'MISSED_DELIVERY', 'FAILED'])
    expect(events.at(-1)!.meta).toMatchObject({ via: 'status-cleanup' })
  })

  it('turns refunded into the real status plus a refund of the order amount', async () => {
    const delivered = await makeOrder({ status: 'REFUNDED', amountPaise: 23600, events: [ev(null, 'RECEIVED'), ev('DISPATCHED', 'DELIVERED'), ev('DELIVERED', 'REFUNDED')] })
    const early = await makeOrder({ status: 'REFUND', amountPaise: 15000, events: [ev(null, 'RECEIVED'), ev('ACCEPTED', 'REFUND')] })
    await cleanUpRetiredStatuses()
    expect(await read(delivered._id)).toMatchObject({ status: 'DELIVERED', refund: { amountPaise: 23600 } })
    // Refunded before it was cooked: the order ended there.
    expect(await read(early._id)).toMatchObject({ status: 'CANCELLED', refund: { amountPaise: 15000, reason: 'CANCELLED' } })
  })

  it('turns a rating order into a tag on its real status', async () => {
    const o = await makeOrder({ status: 'RATING_ORDER', events: [ev(null, 'RECEIVED'), ev('RECEIVED', 'ACCEPTED'), ev('ACCEPTED', 'RATING_ORDER')] })
    await cleanUpRetiredStatuses()
    const after = await read(o._id)
    expect(after.ratingOrder).toBe(true)
    // It was still in the kitchen, so it closes rather than reappearing there.
    expect(after.status).toBe('CANCELLED')
  })

  it('does nothing the second time, and leaves current statuses alone', async () => {
    const live = await makeOrder({ status: 'ACCEPTED' })
    await makeOrder({ status: 'MISDELIVERY', events: [ev('DISPATCHED', 'MISDELIVERY')] })
    const first = await cleanUpRetiredStatuses()
    const second = await cleanUpRetiredStatuses()
    expect(Object.values(first.converted).reduce((a, b) => a + b, 0)).toBe(1)
    expect(second.converted).toEqual({})
    expect((await read(live._id)).status).toBe('ACCEPTED')
  })
})
