import { beforeEach, describe, expect, it, vi } from 'vitest'

// The outlet and rider lookups are the only database reads; stubbing them
// keeps this a pure test of the clause the search box produces.
const found = vi.hoisted(() => ({ outlets: [] as { _id: string }[], riders: [] as { _id: string }[] }))
vi.mock('@/lib/models', () => {
  const lookup = (key: 'outlets' | 'riders') => () => ({
    select: () => ({ lean: async () => found[key] }),
  })
  return { Restaurant: { find: vi.fn(lookup('outlets')) }, User: { find: vi.fn(lookup('riders')) } }
})

import { ORDER_SEARCH_FIELDS, orderSearchClause, parseStations } from '../src/lib/repo/orderSearch'

type Or = { $or: Record<string, unknown>[] }

describe('orderSearchClause', () => {
  beforeEach(() => {
    found.outlets = []
    found.riders = []
  })

  it('is null for a blank term', async () => {
    expect(await orderSearchClause('   ')).toBeNull()
    expect(await orderSearchClause('#')).toBeNull()
  })

  it('searches every order field, case-insensitively and literally', async () => {
    const clause = (await orderSearchClause('a+b (1)')) as Or
    for (const f of ORDER_SEARCH_FIELDS) {
      expect(clause.$or).toContainEqual({ [f]: { $regex: 'a\\+b \\(1\\)', $options: 'i' } })
    }
  })

  it('drops the leading # aggregator subjects put on ids', async () => {
    const clause = (await orderSearchClause('#6004807')) as Or
    expect(clause.$or).toContainEqual({ externalOrderId: { $regex: '6004807', $options: 'i' } })
  })

  it('matches an aggregator by its label as well as its code', async () => {
    const byLabel = (await orderSearchClause('yatri restro')) as Or
    expect(byLabel.$or).toContainEqual({ source: { $in: ['YATRIRESTRO'] } })
    const byPart = (await orderSearchClause('zoop')) as Or
    expect(byPart.$or).toContainEqual({ source: { $in: ['ZOOP'] } })
  })

  it('matches outlets and riders by name through their ids', async () => {
    found.outlets = [{ _id: 'o1' }]
    found.riders = [{ _id: 'r1' }, { _id: 'r2' }]
    const clause = (await orderSearchClause('ravi')) as Or
    expect(clause.$or).toContainEqual({ restaurantId: { $in: ['o1'] } })
    expect(clause.$or).toContainEqual({ 'delivery.agentIds': { $in: ['r1', 'r2'] } })
  })

  it('adds no id clauses when no outlet or rider matches', async () => {
    const clause = (await orderSearchClause('12345')) as Or
    expect(clause.$or.some((c) => 'restaurantId' in c || 'delivery.agentIds' in c || 'source' in c)).toBe(false)
  })
})

describe('parseStations', () => {
  it('reads repeated and comma-separated values, upper-cased and de-duplicated', () => {
    expect(parseStations(['gaya', 'CNB,  gaya', '', ' dhn '])).toEqual(['GAYA', 'CNB', 'DHN'])
  })

  it('is empty for nothing picked', () => {
    expect(parseStations([])).toEqual([])
  })
})
