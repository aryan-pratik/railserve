import { beforeEach, describe, expect, it } from 'vitest'
import { Order } from '../src/lib/models'
import { migrateLegacyStatuses } from '../scripts/migrate-legacy-statuses'
import { resetDb, makeOrder } from './fixtures'

beforeEach(resetDb)

describe('migrateLegacyStatuses', () => {
  it('renames MISSED_DELEVERY orders to MISSED_DELIVERY, current status and events', async () => {
    const order = await makeOrder({
      status: 'MISSED_DELEVERY',
      events: [
        { fromStatus: null, toStatus: 'RECEIVED', userId: null, meta: {}, createdAt: new Date() },
        {
          fromStatus: 'RECEIVED',
          toStatus: 'MISSED_DELEVERY',
          userId: null,
          meta: { via: 'admin-override' },
          createdAt: new Date(),
        },
      ],
    })

    const report = await migrateLegacyStatuses()

    expect(report.ordersRenamed.MISSED_DELEVERY).toBe(1)

    const updated = await Order.findById(order._id).lean()
    expect(updated!.status).toBe('MISSED_DELIVERY')
    expect(updated!.events.map((e) => e.toStatus)).toEqual(['RECEIVED', 'MISSED_DELIVERY'])
    expect(updated!.events.map((e) => e.fromStatus)).toEqual([null, 'RECEIVED'])
  })

  it('renames REFUND orders to REFUNDED', async () => {
    await makeOrder({
      status: 'REFUND',
      events: [
        { fromStatus: null, toStatus: 'RECEIVED', userId: null, meta: {}, createdAt: new Date() },
        {
          fromStatus: 'RECEIVED',
          toStatus: 'REFUND',
          userId: null,
          meta: { via: 'admin-override' },
          createdAt: new Date(),
        },
      ],
    })

    const report = await migrateLegacyStatuses()

    expect(report.ordersRenamed.REFUND).toBe(1)
    expect(await Order.countDocuments({ status: 'REFUNDED' })).toBe(1)
    expect(await Order.countDocuments({ status: 'REFUND' })).toBe(0)
  })

  it('is idempotent: a second run renames nothing further', async () => {
    await makeOrder({ status: 'MISSED_DELEVERY' })

    await migrateLegacyStatuses()
    const second = await migrateLegacyStatuses()

    expect(second.ordersRenamed.MISSED_DELEVERY).toBe(0)
    expect(second.ordersRenamed.REFUND).toBe(0)
    expect(second.eventsRewritten).toBe(0)
  })

  it('leaves orders in other statuses untouched', async () => {
    await makeOrder({ status: 'RECEIVED' })

    const report = await migrateLegacyStatuses()

    expect(report.ordersRenamed.MISSED_DELEVERY).toBe(0)
    expect(report.ordersRenamed.REFUND).toBe(0)
    expect(await Order.countDocuments({ status: 'RECEIVED' })).toBe(1)
  })
})
