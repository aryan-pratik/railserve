import { describe, expect, it } from 'vitest'
import { busiestSlot, busyGrid, bulkSummary, change, dishKey, dishStats, groupBy, headline, losses, reportPeriod, returning, riderStats, salesSeries, type ReportOrder } from '../src/lib/v2/reports'

const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+05:30`)
let n = 0
function order(over: Partial<ReportOrder> = {}): ReportOrder {
  n += 1
  return {
    serviceDate: '2026-11-24', createdAt: at('2026-11-24', '09:00'), arrival: at('2026-11-24', '13:10'), status: 'DELIVERED',
    amountPaise: 20000, paymentMode: 'PREPAID', source: 'YATRIBHOJAN', orderType: 'RETAIL', outletId: 'k1', stationCode: 'CNB',
    trainNo: '12554', trainName: 'VAISHALI EXP', phone: `98765${String(n).padStart(5, '0')}`, ratingOrder: false,
    refundPaise: 0, refundByUs: false, items: [{ name: 'Veg Mini Thali', qty: 1, isPacking: false, spec: null }],
    cooked: true, deliveredAt: null, dispatchedAt: null, failureReason: null, riderId: null, returned: false, ...over,
  }
}

describe('the period and what it is compared with', () => {
  it('compares this week so far with the same weekdays last week', () => {
    const p = reportPeriod('week', {}, '2026-11-26') // a Thursday
    expect([p.from, p.to, p.prevFrom, p.prevTo]).toEqual(['2026-11-23', '2026-11-26', '2026-11-16', '2026-11-19'])
    expect(p.days).toHaveLength(4)
  })
  it('compares this month so far with the same dates last month, clipped to its length', () => {
    const p = reportPeriod('month', {}, '2026-03-31')
    expect([p.from, p.to, p.prevFrom, p.prevTo]).toEqual(['2026-03-01', '2026-03-31', '2026-02-01', '2026-02-28'])
  })
  it('compares a chosen range with as many days just before it, and never runs past today', () => {
    const p = reportPeriod('range', { from: '2026-11-20', to: '2026-12-30' }, '2026-11-26')
    expect([p.from, p.to, p.prevFrom, p.prevTo]).toEqual(['2026-11-20', '2026-11-26', '2026-11-13', '2026-11-19'])
  })
  it('compares today with the same day last week', () => {
    const p = reportPeriod('today', {}, '2026-11-26')
    expect([p.prevFrom, p.prevTo]).toEqual(['2026-11-19', '2026-11-19'])
  })
  it('reports no change against nothing', () => {
    expect(change(5, 0)).toBeNull()
    expect(change(150, 100)).toBe(50)
  })
})

describe('sales', () => {
  it('counts every order not cancelled or undelivered, shows what is unclosed, and leaves decoys out', () => {
    const h = headline([
      order({ amountPaise: 30000, paymentMode: 'COD' }),
      order({ status: 'PREPARED', amountPaise: 10000 }),
      order({ status: 'CANCELLED', cooked: false }),
      order({ status: 'FAILED', amountPaise: 5000 }),
      order({ ratingOrder: true, amountPaise: 99900 }),
    ])
    expect(h.orders).toBe(2)
    expect(h.salesPaise).toBe(40000)
    expect(h.deliveredPaise).toBe(30000)
    expect(h.unclosedOrders).toBe(1)
    expect(h.cashPaise).toBe(30000)
    expect(h.avgPaise).toBe(20000)
    expect(h.lostPaise).toBe(5000) // the not-delivered order was cooked
  })
  it('shows a single day by the hour the trains arrive', () => {
    const p = reportPeriod('today', {}, '2026-11-24')
    const s = salesSeries([order(), order({ arrival: at('2026-11-24', '19:40') })], p)
    expect(s.find((r) => r.label === '1 pm')?.orders).toBe(1)
    expect(s.find((r) => r.label === '7 pm')?.orders).toBe(1)
  })
})

describe('dishes', () => {
  it('merges spellings that differ only in case, spacing, a veg tag or "spl"', () => {
    expect(dishKey('Chicken Biryani With Raita Combo (non-veg)')).toBe(dishKey('chicken biryani with raita combo'))
    expect(dishKey('SPL Veg Thali')).toBe(dishKey('Special  Veg Thali'))
    expect(dishKey('Aloo Paratha')).not.toBe(dishKey('Paneer Paratha'))
  })
  it('counts quantity, keeps bulk orders and packing out, and finds risers and dishes that stopped', () => {
    const now = [
      order({ items: [{ name: 'VEG MINI THALI', qty: 3, isPacking: false, spec: null }, { name: 'Spoon', qty: 3, isPacking: true, spec: null }] }),
      order({ items: [{ name: 'Veg Mini Thali', qty: 1, isPacking: false, spec: null }] }),
      order({ orderType: 'BULK', items: [{ name: 'Bulk thali × 75', qty: 75, isPacking: false, spec: 'dal, rice' }] }),
      order({ status: 'CANCELLED', cooked: false, items: [{ name: 'Chilli Paneer', qty: 9, isPacking: false, spec: null }] }),
    ]
    const before = [order({ items: [{ name: 'veg mini thali', qty: 2, isPacking: false, spec: null }] }), order({ items: [{ name: 'Rajma Chawal', qty: 4, isPacking: false, spec: null }] })]
    const { dishes, stopped } = dishStats(now, before)
    expect(dishes).toHaveLength(1)
    expect(dishes[0]).toMatchObject({ name: 'Veg Mini Thali', qty: 4, orders: 2, prevQty: 2, change: 100 })
    expect(dishes[0].byHour[13]).toBe(4)
    expect(stopped).toEqual([{ name: 'Rajma Chawal', prevQty: 4 }])
    expect(bulkSummary(now)).toEqual({ orders: 1, plates: 75, paise: 20000 })
  })
})

describe('busy times, sources, losses, riders and passengers', () => {
  it('finds the busiest two hours by train arrival', () => {
    const grid = busyGrid([order(), order(), order({ arrival: at('2026-11-24', '14:20') }), order({ arrival: at('2026-11-24', '20:00') })])
    expect(busiestSlot(grid)).toEqual({ weekday: 1, hour: 13, orders: 3 }) // Tuesday 1-3 pm
  })
  it('groups sales by aggregator with their share and how many were lost', () => {
    const g = groupBy([order({ amountPaise: 30000 }), order({ source: 'ZOOP', amountPaise: 10000 }), order({ source: 'ZOOP', status: 'CANCELLED' })], (o) => o.source)
    expect(g.map((x) => [x.key, x.share, x.lostRate])).toEqual([['YATRIBHOJAN', 75, 0], ['ZOOP', 25, 50]])
  })
  it('separates food cooked and lost from early cancellations, and counts only our own refunds as lost', () => {
    const l = losses([
      order({ status: 'CANCELLED', cooked: true, amountPaise: 400 }),
      order({ status: 'CANCELLED', cooked: false, amountPaise: 700 }),
      order({ status: 'FAILED', failureReason: 'Not delivered: Passenger did not pick up the phone', amountPaise: 300 }),
      order({ refundPaise: 200, refundByUs: true }),
      order({ refundPaise: 900, refundByUs: false }),
      order({ ratingOrder: true, amountPaise: 500 }),
    ])
    expect(l.cookedLost).toEqual({ orders: 2, paise: 700 })
    expect(l.cancelledEarly).toEqual({ orders: 1, paise: 700 })
    expect(l.notDelivered.reasons).toEqual([{ reason: 'Passenger did not pick up the phone', orders: 1 }])
    expect(l.refundsUs.paise).toBe(200)
    expect(l.refundsAggregator.paise).toBe(900)
    expect(l.rating).toEqual({ orders: 1, paise: 500 })
  })
  it("rates riders by deliveries, failures and minutes from pickup to delivery", () => {
    const r = riderStats([
      order({ riderId: 'r1', dispatchedAt: at('2026-11-24', '13:00'), deliveredAt: at('2026-11-24', '13:20') }),
      order({ riderId: 'r1', status: 'FAILED' }),
    ])
    expect(r).toEqual([{ riderId: 'r1', delivered: 1, notDelivered: 1, rate: 50, avgMinutes: 20 }])
  })
  it('counts a passenger as returning when they ordered before or twice in the period', () => {
    const orders = [order({ phone: '9811111111' }), order({ phone: '+91 98111 11111' }), order({ phone: '9822222222' }), order({ phone: '9833333333' })]
    expect(returning(orders, new Set(['9833333333']))).toEqual({ passengers: 3, returning: 2, share: 67 })
  })
})

describe('reasons, read by a person', () => {
  it('turns a code into words and drops the "Not delivered:" prefix', async () => {
    const { readableReason } = await import('../src/lib/v2/reports')
    expect(readableReason('MISSED_TRAIN')).toBe('Missed train')
    expect(readableReason('Not delivered: Passenger did not pick up the phone')).toBe('Passenger did not pick up the phone')
    expect(readableReason(null)).toBe('No reason given')
  })
})
