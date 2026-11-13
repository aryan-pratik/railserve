import { describe, expect, it } from 'vitest'
import {
  analyticsParams, buildSeries, granularityFor, outcomeOf, readAnalyticsFilters, tallyAll, tallyByKey,
  type CountRow,
} from '../src/lib/analytics'

const row = (key: string | null, status: string, orders: number, amountPaise = 0): CountRow => ({
  key, status, orders, amountPaise,
})

describe('outcomeOf', () => {
  it('folds every pipeline status into one outcome', () => {
    expect(outcomeOf('DELIVERED')).toBe('delivered')
    expect(outcomeOf('KOT_PRINTED')).toBe('progress')
    expect(outcomeOf('DISPATCHED')).toBe('progress')
    expect(outcomeOf('FAILED')).toBe('undelivered')
    expect(outcomeOf('MISSED_DELIVERY')).toBe('undelivered')
    expect(outcomeOf('CANCELLED')).toBe('cancelled')
    expect(outcomeOf('LOST')).toBe('cancelled')
  })

  it('counts refunds and custom statuses as other rather than dropping them', () => {
    expect(outcomeOf('REFUNDED')).toBe('other')
    expect(outcomeOf('ON HOLD AT COUNTER')).toBe('other')
  })
})

describe('readAnalyticsFilters', () => {
  it('opens on this month, comparing outlets', () => {
    const f = readAnalyticsFilters({})
    expect(f.mode).toBe('month')
    expect(f.from.slice(8)).toBe('01')
    expect(f.by).toBe('outlet')
    expect(f.bySet).toBe(false)
  })

  it('drops values it does not recognise', () => {
    const f = readAnalyticsFilters({
      outlet: 'not-an-id', source: 'NOPE', payment: 'BARTER', rider: 'someone', type: 'X', mode: 'all', by: 'nope',
      status: 'RATING_ORDER', station: ['cnb', 'bad code!'],
    })
    expect(f).toMatchObject({ outlet: '', source: '', payment: '', rider: '', type: '', mode: 'month', status: '', by: 'outlet' })
    expect(f.stations).toEqual(['CNB'])
  })

  it('always resolves a bounded range, in order', () => {
    const half = readAnalyticsFilters({ mode: 'range', from: '2026-11-05' })
    expect([half.from, half.to]).toEqual(['2026-11-05', '2026-11-05'])
    const swapped = readAnalyticsFilters({ mode: 'range', from: '2026-11-09', to: '2026-11-02' })
    expect([swapped.from, swapped.to]).toEqual(['2026-11-02', '2026-11-09'])
  })

  it('moves the comparison on once a dimension is narrowed to one value', () => {
    const outlet = 'a'.repeat(24)
    expect(readAnalyticsFilters({ outlet }).by).toBe('source')
    expect(readAnalyticsFilters({ outlet, source: 'ZOOP' }).by).toBe('station')
    expect(readAnalyticsFilters({ outlet, by: 'outlet' }).by).toBe('outlet')
  })

  it('round-trips through its own query string', () => {
    const sp = {
      mode: 'range', from: '2026-10-01', to: '2026-10-31', outlet: 'b'.repeat(24), source: 'ZOOP',
      payment: 'COD', rider: 'c'.repeat(24), type: 'RETAIL', status: 'undelivered', by: 'day', station: ['CNB', 'PRYJ'],
    }
    const u = analyticsParams(readAnalyticsFilters(sp))
    const back: Record<string, string | string[]> = {}
    for (const k of new Set(u.keys())) back[k] = u.getAll(k).length > 1 ? u.getAll(k) : u.get(k)!
    expect(back).toEqual(sp)
  })

  it('lets a link override or clear single fields', () => {
    const f = readAnalyticsFilters({ status: 'DELIVERED', source: 'ZOOP' })
    expect(analyticsParams(f, { status: '' }).toString()).toBe('source=ZOOP')
    expect(analyticsParams(f, { stations: ['CNB'] }).getAll('station')).toEqual(['CNB'])
  })
})

describe('tallies', () => {
  const rows = [
    row('A', 'DELIVERED', 6, 60_000),
    row('A', 'FAILED', 1, 10_000),
    row('A', 'CANCELLED', 1, 5_000),
    row('B', 'DELIVERED', 2, 20_000),
    row('B', 'ACCEPTED', 9, 90_000),
    row(null, 'REFUNDED', 1, 1_000),
  ]

  it('groups by key, busiest first, and only counts delivered value as earned', () => {
    const [first, second, third] = tallyByKey(rows)
    expect(first).toMatchObject({ key: 'B', total: 11, amountPaise: 110_000, deliveredPaise: 20_000 })
    expect(first.counts).toMatchObject({ delivered: 2, progress: 9 })
    expect(second).toMatchObject({ key: 'A', total: 8, deliveredPaise: 60_000 })
    expect(second.counts).toMatchObject({ delivered: 6, undelivered: 1, cancelled: 1 })
    expect(second.amounts).toMatchObject({ delivered: 60_000, undelivered: 10_000, cancelled: 5_000, progress: 0 })
    expect(third).toMatchObject({ key: null, total: 1 })
    expect(third.counts.other).toBe(1)
  })

  it('sums everything into one line, and is zero for nothing', () => {
    expect(tallyAll(rows)).toMatchObject({ total: 20, amountPaise: 186_000, deliveredPaise: 80_000 })
    expect(tallyAll([]).total).toBe(0)
  })
})

describe('buildSeries', () => {
  it('draws a bucket for every day in range, including the quiet ones', () => {
    const { granularity, buckets } = buildSeries(
      [row('2026-11-02', 'DELIVERED', 3), row('2026-11-02', 'FAILED', 1), row('2026-11-04', 'ACCEPTED', 2)],
      '2026-11-01', '2026-11-05',
    )
    expect(granularity).toBe('day')
    expect(buckets.map((b) => b.total)).toEqual([0, 4, 0, 2, 0])
    expect(buckets[1].counts).toMatchObject({ delivered: 3, undelivered: 1 })
    expect(buckets[0].label).toBe('1 Nov')
    expect(buckets[1].label).toBe('2')
    expect(buckets[1].title).toBe('Mon 2 Nov 2026')
  })

  it('widens to weeks and months as the range grows, losing no orders', () => {
    expect(granularityFor('2026-11-01', '2026-11-30')).toBe('day')
    expect(granularityFor('2026-08-01', '2026-11-30')).toBe('week')
    expect(granularityFor('2026-01-01', '2026-12-31')).toBe('month')

    const weekly = buildSeries(
      [row('2026-08-01', 'DELIVERED', 1), row('2026-08-07', 'DELIVERED', 1), row('2026-08-08', 'DELIVERED', 5)],
      '2026-08-01', '2026-11-30',
    )
    expect(weekly.buckets[0].total).toBe(2)
    expect(weekly.buckets[1].total).toBe(5)
    expect(weekly.buckets[0].title).toBe('1 – 7 Aug 2026')

    const monthly = buildSeries(
      [row('2026-01-31', 'DELIVERED', 4), row('2026-02-01', 'CANCELLED', 2), row('2026-12-31', 'DELIVERED', 1)],
      '2026-01-01', '2026-12-31',
    )
    expect(monthly.buckets).toHaveLength(12)
    expect(monthly.buckets.map((b) => b.total).reduce((a, b) => a + b, 0)).toBe(7)
    expect(monthly.buckets[1]).toMatchObject({ title: 'Feb 2026', total: 2 })
  })

  it('ignores rows outside the range rather than piling them onto an edge', () => {
    const { buckets } = buildSeries([row('2026-10-31', 'DELIVERED', 9)], '2026-11-01', '2026-11-03')
    expect(buckets.every((b) => b.total === 0)).toBe(true)
  })
})
