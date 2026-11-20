import { beforeEach, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import {
  dietFor, menuKey, menuLookupKey, orderDietOf, splitKotParts, suggestDiet, type Diet,
} from '../src/lib/diet'
import { MenuItem } from '../src/lib/models'
import {
  confirmMenuItems, dietLookupFor, kotPartCounts, menuOverview, registerMenuItems, setMenuItemDiet,
} from '../src/lib/repo/menuRepo'
import { insertOrder } from '../src/lib/repo/orderRepo'
import type { AuthContext } from '../src/lib/authContext'
import { resetDb } from './fixtures'

/**
 * The menu database decides which KOT an item prints on. Two things must
 * hold: the tag comes from the table (by aggregator and item name), and
 * non-veg never shares a ticket with anything else.
 */

const ADMIN: AuthContext = { userId: new mongoose.Types.ObjectId(), role: 'ADMIN', restaurantIds: [] }

const item = (name: string, isPacking = false) => ({ _id: name, name, qty: 1, isPacking })
const lookupOf = (rows: [string, string, Diet | null][]) =>
  new Map(rows.map(([source, name, diet]) => [menuLookupKey(source, name), diet]))

let seq = 0
async function order(source: string, names: string[], extra: Record<string, unknown> = {}) {
  seq += 1
  return insertOrder({
    source, orderType: 'RETAIL', externalOrderId: `MENU-${seq}`, status: 'RECEIVED',
    stationCode: 'CNB', serviceDate: '2026-11-20',
    items: names.map((name) => ({ name, qty: 2 })),
    ...extra,
  })
}

describe('menuKey', () => {
  it('ignores case, spacing and trailing punctuation, and nothing else', () => {
    expect(menuKey('  Majedaar   Aloo Paratha. ')).toBe('majedaar aloo paratha')
    expect(menuKey('Aloo Paratha')).not.toBe(menuKey('Aloo Paratha with Soft Drink'))
  })
})

describe('suggestDiet', () => {
  it.each([
    ['Chicken Biryani', 'NON_VEG'], ['Egg Curry with Rice', 'NON_VEG'], ['Anda Bhurji', 'NON_VEG'],
    ['Non-Veg Thali', 'NON_VEG'], ['NonVeg Combo', 'NON_VEG'], ['Fish Fry', 'NON_VEG'], ['Mutton Rogan Josh', 'NON_VEG'],
    ['Aloo Paratha', 'VEG'], ['Veg Thali', 'VEG'], ['Eggless Cake', 'VEG'], ['Paneer Butter Masala', 'VEG'],
    ['Veg Biryani', 'VEG'], ['Hara Bhara Kabab', 'VEG'],
  ])('%s is suggested %s', (name, diet) => {
    expect(suggestDiet(name)).toBe(diet)
  })
})

describe('splitKotParts', () => {
  const lookup = lookupOf([
    ['ZOOP', 'Aloo Paratha', 'VEG'],
    ['ZOOP', 'Chicken Curry', 'NON_VEG'],
    ['ZOOP', 'Egg Roll', 'NON_VEG'],
  ])

  it('prints one veg KOT for an all-veg order', () => {
    const parts = splitKotParts(lookup, 'ZOOP', [item('Aloo Paratha'), item('Tissue', true)])
    expect(parts.map((p) => [p.diet, p.index, p.of])).toEqual([['VEG', 1, 1]])
    expect(parts[0].items.map((i) => i.name)).toEqual(['Aloo Paratha', 'Tissue'])
  })

  it('prints one non-veg KOT for an all-non-veg order', () => {
    const parts = splitKotParts(lookup, 'ZOOP', [item('Chicken Curry'), item('Egg Roll')])
    expect(parts.map((p) => [p.diet, p.of])).toEqual([['NON_VEG', 1]])
  })

  it('prints two KOTs when an order has even one non-veg item, non-veg on its own', () => {
    const parts = splitKotParts(lookup, 'ZOOP', [
      item('Aloo Paratha'), item('Chicken Curry'), item('Spoon', true),
    ])
    expect(parts.map((p) => [p.diet, p.index, p.of])).toEqual([['VEG', 1, 2], ['NON_VEG', 2, 2]])
    expect(parts[0].items.map((i) => i.name)).toEqual(['Aloo Paratha', 'Spoon'])
    expect(parts[1].items.map((i) => i.name)).toEqual(['Chicken Curry'])
  })

  it('never guesses from the name: an item missing from the menu is untagged, not non-veg', () => {
    // "Chicken Tikka" reads non-veg, but this aggregator's menu has no row for it.
    const parts = splitKotParts(lookup, 'ZOOP', [item('Chicken Tikka')])
    expect(parts).toHaveLength(1)
    expect(parts[0].diet).toBe('VEG')
    expect(parts[0].items[0].diet).toBeNull()
  })

  it('reads the tag per aggregator', () => {
    expect(dietFor(lookup, 'ZOOP', item('chicken curry'))).toBe('NON_VEG')
    expect(dietFor(lookup, 'OLF', item('Chicken Curry'))).toBeNull()
  })
})

describe('orderDietOf', () => {
  it('sums an order up to one mark', () => {
    expect(orderDietOf([])).toBeNull()
    expect(orderDietOf(['VEG', 'VEG'])).toBe('VEG')
    expect(orderDietOf(['NON_VEG'])).toBe('NON_VEG')
    expect(orderDietOf(['VEG', 'NON_VEG'])).toBe('MIXED')
    expect(orderDietOf(['VEG', null])).toBe('UNTAGGED')
  })
})

describe('menu database', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('registers the dishes on a new order, per aggregator, with an unconfirmed suggestion', async () => {
    await order('ZOOP', ['Aloo Paratha', 'Chicken Biryani'], {
      items: [{ name: 'Aloo Paratha', qty: 1 }, { name: 'Chicken Biryani', qty: 1 }, { name: 'Tissue', qty: 1, isPacking: true }],
    })
    await order('OLF', ['ALOO PARATHA'])

    const rows = await MenuItem.find({}).sort({ source: 1, key: 1 }).lean()
    expect(rows.map((r) => [r.source, r.key, r.diet, r.reviewed])).toEqual([
      ['OLF', 'aloo paratha', 'VEG', false],
      ['ZOOP', 'aloo paratha', 'VEG', false],
      ['ZOOP', 'chicken biryani', 'NON_VEG', false],
    ])
  })

  it('does not overwrite a tag somebody set when the dish is ordered again', async () => {
    await order('ZOOP', ['Soya Chaap'])
    const row = await MenuItem.findOne({ key: 'soya chaap' })
    await setMenuItemDiet(ADMIN, String(row!._id), 'NON_VEG')
    await order('ZOOP', ['soya chaap'])
    await registerMenuItems([{ source: 'ZOOP', name: 'Soya Chaap' }])

    const after = await MenuItem.find({ key: 'soya chaap' }).lean()
    expect(after).toHaveLength(1)
    expect(after[0].diet).toBe('NON_VEG')
    expect(after[0].reviewed).toBe(true)
  })

  it('counts orders per dish and adds dishes found only in old orders', async () => {
    await order('ZOOP', ['Aloo Paratha'])
    await order('ZOOP', ['aloo  paratha.', 'Dal Fry'])
    // An order from before the menu existed: nothing registered it.
    await MenuItem.deleteMany({ key: 'dal fry' })

    const rows = await menuOverview(ADMIN)
    const byName = new Map(rows.map((r) => [`${r.source}|${r.name.toLowerCase()}`, r]))
    expect(byName.get('ZOOP|aloo paratha')).toMatchObject({ orderCount: 2, qty: 4, diet: 'VEG', reviewed: false })
    expect(byName.get('ZOOP|dal fry')).toMatchObject({ orderCount: 1, qty: 2 })
    expect(await MenuItem.countDocuments({ key: 'dal fry' })).toBe(1)
  })

  it('confirms suggestions, and a cleared tag reads as untagged', async () => {
    await order('ZOOP', ['Aloo Paratha', 'Egg Roll'])
    const rows = await MenuItem.find({}).lean()
    expect(await confirmMenuItems(ADMIN, rows.map((r) => String(r._id)))).toBe(2)
    expect(await MenuItem.countDocuments({ reviewed: true })).toBe(2)

    const egg = rows.find((r) => r.key === 'egg roll')!
    await setMenuItemDiet(ADMIN, String(egg._id), null)
    const lookup = await dietLookupFor([{ source: 'ZOOP', items: [{ name: 'Egg Roll' }, { name: 'Aloo Paratha' }] }])
    expect(lookup.get(menuLookupKey('ZOOP', 'Egg Roll'))).toBeNull()
    expect(lookup.get(menuLookupKey('ZOOP', 'Aloo Paratha'))).toBe('VEG')
  })

  it('only an admin may tag', async () => {
    await order('ZOOP', ['Aloo Paratha'])
    const row = await MenuItem.findOne({})
    const manager: AuthContext = { ...ADMIN, role: 'STORE_MANAGER' }
    await expect(setMenuItemDiet(manager, String(row!._id), 'NON_VEG')).rejects.toThrow(/admin/)
    await expect(menuOverview(manager)).rejects.toThrow(/admin/)
  })

  it('counts two KOT parts for a mixed order and one otherwise', async () => {
    const mixed = await order('ZOOP', ['Aloo Paratha', 'Chicken Curry'])
    const veg = await order('ZOOP', ['Aloo Paratha'])
    const nonVeg = await order('ZOOP', ['Chicken Curry'])
    const counts = await kotPartCounts([mixed, veg, nonVeg].map((o) => String(o._id)))
    expect([mixed, veg, nonVeg].map((o) => counts.get(String(o._id)))).toEqual([2, 1, 1])
  })
})
