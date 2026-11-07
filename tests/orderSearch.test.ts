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

import {
  ORDER_SEARCH_FIELDS, orderSearchClause, parseStations, phoneDigits, searchTerms,
} from '../src/lib/repo/orderSearch'

type Or = { $or: Record<string, unknown>[] }
type And = { $and: Or[] }

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
    const clause = (await orderSearchClause('a+b(1)')) as Or
    for (const f of ORDER_SEARCH_FIELDS) {
      expect(clause.$or).toContainEqual({ [f]: { $regex: 'a\\+b\\(1\\)', $options: 'i' } })
    }
  })

  it('drops the leading # aggregator subjects put on ids', async () => {
    const clause = (await orderSearchClause('#6004807')) as Or
    expect(clause.$or).toContainEqual({ externalOrderId: { $regex: '6004807', $options: 'i' } })
  })

  it('matches an aggregator by its label as well as its code', async () => {
    // Two words, each of which the label carries.
    const byLabel = (await orderSearchClause('yatri restro')) as And
    for (const part of byLabel.$and) {
      const src = part.$or.find((c) => 'source' in c) as { source: { $in: string[] } }
      expect(src.source.$in).toContain('YATRIRESTRO')
    }
    const squashed = (await orderSearchClause('yatrirestro')) as Or
    expect(squashed.$or).toContainEqual({ source: { $in: ['YATRIRESTRO'] } })
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

describe('searchTerms', () => {
  it('splits on spaces and commas and drops a leading #', () => {
    expect(searchTerms('  Rahul,  12301 #6004807 ')).toEqual(['Rahul', '12301', '6004807'])
  })

  it('keeps a prefixed or punctuated phone number as its ten stored digits', () => {
    expect(searchTerms('+91 98765 43210')).toEqual(['9876543210'])
    expect(searchTerms('098765-43210')).toEqual(['9876543210'])
    expect(searchTerms('98765-43210')).toEqual(['9876543210'])
    expect(searchTerms('919876543210')).toEqual(['9876543210'])
  })

  it('leaves two train numbers as two words', () => {
    expect(searchTerms('12301 12302')).toEqual(['12301', '12302'])
  })

  it('caps the number of words', () => {
    expect(searchTerms('a b c d e f g h')).toHaveLength(6)
  })
})

describe('phoneDigits', () => {
  it('is null for anything that is not a phone number', () => {
    expect(phoneDigits('12301')).toBeNull()
    expect(phoneDigits('B4-23')).toBeNull()
    expect(phoneDigits('12345678901234')).toBeNull()
  })
})

describe('orderSearchClause across words and formats', () => {
  beforeEach(() => {
    found.outlets = []
    found.riders = []
  })

  it('needs every word to match, each in any field', async () => {
    const clause = (await orderSearchClause('rahul 12301')) as And
    expect(clause.$and).toHaveLength(2)
    expect(clause.$and[0].$or).toContainEqual({ contactName: { $regex: 'rahul', $options: 'i' } })
    expect(clause.$and[1].$or).toContainEqual({ trainNo: { $regex: '12301', $options: 'i' } })
  })

  it('finds a phone typed with the country code', async () => {
    const clause = (await orderSearchClause('+91 98765 43210')) as Or
    expect(clause.$or).toContainEqual({ contactPhone: { $regex: '9876543210', $options: 'i' } })
  })

  it('matches a seat whatever joins coach and berth', async () => {
    const clause = (await orderSearchClause('b4/23')) as Or
    expect(clause.$or).toContainEqual({
      coach: { $regex: '^b4$', $options: 'i' },
      berth: { $regex: '^23$', $options: 'i' },
    })
    const raw = clause.$or.find((c) => 'rawSeat' in c && String((c.rawSeat as { $regex: string }).$regex).startsWith('^'))
    const rx = new RegExp((raw!.rawSeat as { $regex: string }).$regex, 'i')
    expect(rx.test('B4-23')).toBe(true)
    expect(rx.test('B4 / 23')).toBe(true)
    expect(rx.test('B4-231')).toBe(false)
  })

  it('finds an order by its own id', async () => {
    const id = '65a1b2c3d4e5f6a7b8c9d0e1'
    const clause = (await orderSearchClause(id)) as Or
    const byId = clause.$or.find((c) => '_id' in c)
    expect(String(byId?._id)).toBe(id)
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
