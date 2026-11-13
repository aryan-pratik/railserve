import { describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import {
  hasOrderFilters,
  orderFilterClause,
  orderFilterParams,
  readOrderFilters,
} from '../src/lib/repo/orderFilters'
import { NO_RIDER } from '../src/lib/repo/riderFilter'

/**
 * The filter bar shared by All orders and Returns: the same URL has to mean
 * the same thing on both, with only the date the screen opens on differing.
 */
describe('order filter bar', () => {
  it('opens on the screen default and does not count it as a filter', () => {
    const orders = readOrderFilters({}, { defaultMode: 'today' })
    const returns = readOrderFilters({}, { defaultMode: 'all' })
    expect(orders.mode).toBe('today')
    expect(returns.mode).toBe('all')
    expect(hasOrderFilters(orders)).toBe(false)
    expect(hasOrderFilters(returns)).toBe(false)
    expect(orderFilterParams(returns).toString()).toBe('')
  })

  it('searches all time unless a date was picked', () => {
    const searched = readOrderFilters({ q: 'rahul' }, { defaultMode: 'today' })
    expect(searched.mode).toBe('all')
    expect(searched.modeSet).toBe(false)
    // Links leave the implied mode out, so clearing the search lands on today.
    expect(orderFilterParams(searched).toString()).toBe('q=rahul')

    const picked = readOrderFilters({ q: 'rahul', mode: 'today' }, { defaultMode: 'today' })
    expect(picked.mode).toBe('today')
    expect(orderFilterParams(picked).get('mode')).toBe('today')
  })

  it('drops junk type and rider values instead of filtering to nothing', () => {
    const f = readOrderFilters({ type: 'NOPE', rider: 'not-an-id' }, { defaultMode: 'all' })
    expect(f.type).toBe('')
    expect(f.rider).toBe('')
    expect(hasOrderFilters(f)).toBe(false)
  })

  it('keeps the legacy orderId search param working', () => {
    expect(readOrderFilters({ orderId: ' 6004807 ' }, { defaultMode: 'all' }).q).toBe('6004807')
  })

  it('round-trips every field through the query string', () => {
    const rider = String(new mongoose.Types.ObjectId())
    const sp = {
      outlet: 'o1', status: 'CANCELLED', mode: 'range', from: '2026-11-01', to: '2026-11-05',
      train: '12345', type: 'LOCAL', q: 'ravi', rider, station: ['cnb', 'PRYJ,CNB'],
    }
    const f = readOrderFilters(sp, { defaultMode: 'all' })
    expect(f.stations).toEqual(['CNB', 'PRYJ'])
    const again = readOrderFilters(Object.fromEntries(
      [...new Set(orderFilterParams(f).keys())].map((k) => [k, orderFilterParams(f).getAll(k)]),
    ), { defaultMode: 'all' })
    expect(again).toEqual(f)
  })

  it('builds the order clause from the filters', async () => {
    const f = readOrderFilters(
      { status: 'FAILED', train: '12345a', mode: 'range', from: '2026-11-01', to: '2026-11-05', rider: NO_RIDER, type: 'LOCAL' },
      { defaultMode: 'all' },
    )
    expect(await orderFilterClause(f)).toEqual({
      status: 'FAILED',
      trainNo: '12345A',
      orderType: 'LOCAL',
      serviceDate: { $gte: '2026-11-01', $lte: '2026-11-05' },
      // Under $and, so a search added beside it cannot replace it.
      $and: [{ 'delivery.agentIds.0': { $exists: false } }],
    })
  })

  it('adds no date bound on all time', async () => {
    expect(await orderFilterClause(readOrderFilters({}, { defaultMode: 'all' }))).toEqual({})
  })
})
