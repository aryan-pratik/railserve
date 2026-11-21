import { beforeEach, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import {
  bulkThaliName, dietFor, isMenuDish, menuKey, menuLookupKey, orderDiet, orderDietOf, splitKotParts, tagFor,
  type Diet, type MenuTag,
} from '../src/lib/diet'
import { suggestDiet } from '../src/lib/dietSuggest'
import { MenuItem, Order } from '../src/lib/models'
import {
  confirmMenuItems, dietLookupFor, menuOverview, menuRowsOf, registerMenuItems, registerOrderMenu, removeMenuItem,
  restoreMenuItem, setMenuItemDiet,
} from '../src/lib/repo/menuRepo'
import { insertOrder } from '../src/lib/repo/orderRepo'
import { adminAddOrderItem, adminEditOrder, adminEditOrderItem } from '../src/lib/repo/adminEditOrder'
import type { AuthContext } from '../src/lib/authContext'
import { resetDb, tenantId } from './fixtures'

/**
 * The menu database decides which KOT an item prints on. Two things must
 * hold: the tag comes from the table (by aggregator and item name), and
 * non-veg never shares a ticket with anything else.
 */

// A getter: resetDb() makes a fresh tenant per test, so the admin's tenant is
// read when a call uses it, not when the module loads.
const ADMIN: AuthContext = {
  get tenantId() { return tenantId() },
  userId: new mongoose.Types.ObjectId(), role: 'ADMIN', restaurantIds: [],
}

const item = (name: string, isPacking = false, extra: { spec?: string; diet?: string } = {}) => ({
  _id: name, name, qty: 1, isPacking, ...extra,
})
/** A lookup of confirmed tags, unless a row says otherwise. */
const lookupOf = (rows: [string, string, Diet | null, boolean?][]) =>
  new Map<string, MenuTag>(
    rows.map(([source, name, diet, reviewed = true]) => [menuLookupKey(source, name), { diet, reviewed }]),
  )

let seq = 0
async function order(source: string, names: string[], extra: Record<string, unknown> = {}) {
  seq += 1
  return insertOrder({
    tenantId: tenantId(), source, orderType: 'RETAIL', externalOrderId: `MENU-${seq}`, status: 'RECEIVED',
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

  it('folds the dashes, quotes and invisible characters mail clients swap in', () => {
    expect(menuKey('Non–Veg  Thali.')).toBe('non-veg thali')
    expect(menuKey('Non​Veg')).toBe('nonveg')
    expect(menuKey('“Aloo”')).toBe('aloo')
    expect(menuKey('Dal Fry')).toBe('dal fry')
  })

  it('still gives a name that is only punctuation a key of its own', () => {
    expect(menuKey('-')).toBe('-')
    expect(menuKey('   ')).toBe('')
  })

  it('files an unknown aggregator with the hand-entered orders', () => {
    expect(menuLookupKey('SOMETHING_NEW', 'Aloo')).toBe('MANUAL|aloo')
    expect(menuLookupKey(null, 'Aloo')).toBe('MANUAL|aloo')
    expect(menuLookupKey('ZOOP', 'Aloo')).toBe('ZOOP|aloo')
  })
})

describe('suggestDiet', () => {
  const cases: Record<'NON_VEG' | 'VEG' | 'NONE', string[]> = {
    NON_VEG: [
      // The menu saying so, however it is punctuated.
      'Non Vegetarian Thali', 'Non-Vegetarian Thali', 'Nonvegetarian Thali', 'Thali (Non Vegetarian)', 'Non - Veg Thali',
      'Non- Veg Thali', 'Non–Veg Thali', 'Non.Veg Thali', 'N.Veg Thali', 'NV Thali', 'Thali (NV)', 'Non_Veg Thali',
      'Non-Veg Thali', 'NonVeg Combo', 'Non Veg Keema Thali',
      // Hindi and regional words, and the spellings kitchens type.
      'Murga Chawal', 'Desi Murga Thali', 'Tandoori Murga', 'Kukkad Kadhai', 'Gosht Biryani', 'Bakra Curry',
      'Rogan Josh with Rice', 'Machhi Fry', 'Machi Curry', 'Macchi Bhaat', 'Maach Bhaat', 'Rohu Fry', 'Katla Curry',
      'Hilsa Fry', 'Jheenga Masala', 'Shrimp Fried Rice', 'Crab Curry', 'Kaleji Fry', 'Nihari', 'Bheja Fry',
      'Chikken Curry', 'Chickan Masala', 'Chkn Biryani', 'Omlate', 'Bread Omlate', 'Omelete', 'Amlet', 'Aamlet Pav',
      'Andaa Curry', 'Anday ka Salan', 'Andey Ki Bhurji', 'Muttan Curry',
      // Glued to a digit or an underscore.
      'Chicken65', 'Chicken_Biryani',
      'Chicken Biryani', 'Egg Curry with Rice', 'Anda Bhurji', 'Fish Fry', 'Mutton Rogan Josh', 'Butter Chicken',
      'Chicken Tikka', 'Egg Biryani', 'Veg Fried Rice with Egg', 'Chicken Lollipop',
      'चिकन बिरयानी', 'अंडा करी',
      'नॉन वेज थाली',
    ],
    VEG: [
      'Aloo Paratha', 'Veg Thali', 'Paneer Butter Masala', 'Veg Biryani', 'Hara Bhara Kabab',
      // A non-veg word that means the opposite, or nothing.
      'Eggless Cake', 'Egg-less Cake', 'Egg less Cake', 'Veg Fried Rice (No Egg)', 'Veg Noodles Without Egg',
      'Egg Plant Bharta', 'Fisherman Platter',
      // The aggregator's own "(veg)" at the end wins over a meat word in the name.
      'Soya Keema Pav Combo (veg)', 'Veg Keema Matar With Roti Combo (Veg)', 'Paneer Kheema Paratha Combo (veg)',
      'VEG OMELETTE SANDWICH (Veg)',
      'Paneer Tikka', 'Tandoori Roti', 'Butter Naan', 'Rajma Chawal', 'Masala Dosa', 'Paneer n Veg Biryani Combo',
      'Paneer Biryani n Raita Combo', 'Veg Momos', 'Soya Chaap Tikka', 'Jeera Rice', 'Curd', 'Mineral Water',
      'Mushroom Tikka', 'Handi Paneer', 'Shami Kabab veg', 'Dal Makhani', 'Chole Bhature', 'Veg Pulao', 'Tea',
      'Gulab Jamun', 'Nanda Special Thali',
    ],
    // Could be either: no suggestion, so a person decides and the KOT says "?".
    NONE: [
      'Soya Keema', 'Veg Keema', 'Paneer Keema', 'Veg Omelette', 'Besan Omelette', 'Eggless Omelette',
      'Mock Meat Curry', 'Veg Mutton (Soya)', 'Veg Fish Fry', 'Veg Sausage Roll', 'Hyderabadi Dum Biryani',
      'Lucknowi Biryani', 'Seekh Kebab', 'Seekh Kabab Roll', 'Galouti Kebab', 'Tunde Kabab', 'Tandoori Half',
      'Tandoori Leg Piece', 'Leg Piece Biryani', 'Chilli Lollipop (6 pcs)', 'Drums of Heaven', 'Mughlai Paratha',
      'Half Fry', 'Zinger Burger', 'Momos',
    ],
  }

  it.each(cases.NON_VEG)('%s is suggested non-veg', (name) => {
    expect(suggestDiet(name)).toBe('NON_VEG')
  })
  it.each(cases.VEG)('%s is suggested veg', (name) => {
    expect(suggestDiet(name)).toBe('VEG')
  })
  it.each(cases.NONE)('%s gets no suggestion', (name) => {
    expect(suggestDiet(name)).toBeNull()
  })

  it('does not suggest veg for a plain name whose note mentions meat', () => {
    expect(suggestDiet('Thali', 'Chicken curry 2pcs + Daal fry')).toBeNull()
    expect(suggestDiet('Thali', 'Less spicy')).toBe('VEG')
    expect(suggestDiet('Thali', 'no egg please')).toBe('VEG')
  })
})

describe('tagFor', () => {
  const lookup = lookupOf([
    ['ZOOP', 'Aloo Paratha', 'VEG'],
    ['ZOOP', 'Chicken Curry', 'NON_VEG', false],
    ['ZOOP', 'Bulk thali × 40', 'VEG'],
  ])

  it('says whether a person stands behind the tag', () => {
    expect(tagFor(lookup, 'ZOOP', item('Aloo Paratha'))).toEqual({ diet: 'VEG', confirmed: true })
    expect(tagFor(lookup, 'ZOOP', item('Chicken Curry'))).toEqual({ diet: 'NON_VEG', confirmed: false })
    expect(tagFor(lookup, 'ZOOP', item('Dal Fry'))).toEqual({ diet: null, confirmed: false })
  })

  it('lets a tag set on the order win over the menu', () => {
    expect(tagFor(lookup, 'ZOOP', item('Aloo Paratha', false, { diet: 'NON_VEG' }))).toEqual({ diet: 'NON_VEG', confirmed: true })
  })

  it('never reads a bulk thali or a composite item from the menu', () => {
    // Even with a menu row of that exact name: the name counts plates, it is not a dish.
    expect(tagFor(lookup, 'ZOOP', item(bulkThaliName(40)))).toEqual({ diet: null, confirmed: false })
    expect(tagFor(lookup, 'ZOOP', item('Aloo Paratha', false, { spec: 'Paratha\nChicken curry' }))).toEqual({ diet: null, confirmed: false })
    expect(tagFor(lookup, 'ZOOP', item(bulkThaliName(40), false, { diet: 'VEG' }))).toEqual({ diet: 'VEG', confirmed: true })
  })

  it('never tags a packing line', () => {
    expect(tagFor(lookup, 'ZOOP', item('Aloo Paratha', true, { diet: 'VEG' }))).toEqual({ diet: null, confirmed: true })
  })

  it('knows which items are dishes', () => {
    expect(isMenuDish({ name: 'Aloo Paratha' })).toBe(true)
    expect(isMenuDish({ name: 'Aloo Paratha', spec: '  ' })).toBe(true)
    expect(isMenuDish({ name: 'Tissue', isPacking: true })).toBe(false)
    expect(isMenuDish({ name: 'Special Thali', spec: 'Dal, rice, roti' })).toBe(false)
    expect(isMenuDish({ name: bulkThaliName(75) })).toBe(false)
    expect(isMenuDish({ name: 'Bulk Thali x 75' })).toBe(false)
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

  it('splits on a suggested tag too, and marks it as not confirmed', () => {
    const suggested = lookupOf([['ZOOP', 'Aloo Paratha', 'VEG'], ['ZOOP', 'Egg Roll', 'NON_VEG', false]])
    const parts = splitKotParts(suggested, 'ZOOP', [item('Aloo Paratha'), item('Egg Roll')])
    expect(parts.map((p) => p.diet)).toEqual(['VEG', 'NON_VEG'])
    expect(parts[0].items[0]).toMatchObject({ name: 'Aloo Paratha', diet: 'VEG', confirmed: true })
    expect(parts[1].items[0]).toMatchObject({ name: 'Egg Roll', diet: 'NON_VEG', confirmed: false })
  })

  it('puts a bulk thali on the KOT its order says, and on the veg KOT with a ? until it says', () => {
    const thali = (diet?: string) => item(bulkThaliName(40), false, { spec: 'Chicken curry, rice, roti', ...(diet ? { diet } : {}) })
    const untagged = splitKotParts(lookup, 'MANUAL', [thali()])
    expect(untagged.map((p) => p.diet)).toEqual(['VEG'])
    expect(untagged[0].items[0]).toMatchObject({ diet: null, confirmed: false })

    const tagged = splitKotParts(lookup, 'MANUAL', [thali('NON_VEG'), item('Water', true)])
    expect(tagged.map((p) => [p.diet, p.of])).toEqual([['NON_VEG', 1]])
    expect(tagged[0].items[0]).toMatchObject({ diet: 'NON_VEG', confirmed: true })
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

  it('keeps the non-veg signal when another item has no tag', () => {
    expect(orderDietOf(['NON_VEG', null])).toBe('NON_VEG_UNTAGGED')
    expect(orderDietOf(['VEG', 'NON_VEG', null])).toBe('NON_VEG_UNTAGGED')
    const lookup = lookupOf([['ZOOP', 'Chicken Curry', 'NON_VEG']])
    expect(orderDiet(lookup, { source: 'ZOOP', items: [item('Chicken Curry'), item('Mystery Dish'), item('Tissue', true)] }))
      .toBe('NON_VEG_UNTAGGED')
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

    const rows = await MenuItem.find({ tenantId: tenantId() }).sort({ _id: 1 }).lean()
    expect(rows.map((r) => [r._id, r.source, r.key, r.diet, r.reviewed])).toEqual([
      ['OLF|aloo paratha', 'OLF', 'aloo paratha', 'VEG', false],
      ['ZOOP|aloo paratha', 'ZOOP', 'aloo paratha', 'VEG', false],
      ['ZOOP|chicken biryani', 'ZOOP', 'chicken biryani', 'NON_VEG', false],
    ])
  })

  it('registers a dish whose name could be either with no tag at all', async () => {
    await order('ZOOP', ['Seekh Kebab', 'Special Thali'], {
      items: [{ name: 'Seekh Kebab', qty: 1 }, { name: 'Special Thali', qty: 1, notes: 'with chicken curry' }],
    })
    const rows = await MenuItem.find({ tenantId: tenantId() }).sort({ _id: 1 }).lean()
    expect(rows.map((r) => [r.key, r.diet, r.reviewed])).toEqual([
      ['seekh kebab', null, false],
      // The name alone reads veg; the note it arrived with says otherwise.
      ['special thali', null, false],
    ])
  })

  it('never makes a menu row out of a bulk thali', async () => {
    const o = await order('MANUAL', [], {
      orderType: 'BULK', pax: 40,
      items: [
        { name: bulkThaliName(40), qty: 40, spec: 'Dal, rice, chicken curry' },
        // A thali whose menu was not typed in still is not a dish.
        { name: bulkThaliName(41), qty: 41 },
        { name: 'Water bottle', qty: 40, isPacking: true },
      ],
    })
    expect(menuRowsOf(o)).toEqual([])
    expect(await MenuItem.countDocuments({ tenantId: tenantId() })).toBe(0)
    // And the Menu page does not back-fill it from the orders either.
    expect(await menuOverview(ADMIN)).toEqual([])
    expect(await MenuItem.countDocuments({ tenantId: tenantId() })).toBe(0)
  })

  it('makes one row when the same new dish arrives twice at once', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => registerMenuItems(tenantId(), [{ source: 'ZOOP', name: 'Aloo Paratha' }, { source: 'ZOOP', name: 'Dal Fry' }])),
    )
    expect(await MenuItem.countDocuments({ tenantId: tenantId() })).toBe(2)
    // Each dish was inserted by exactly one of the callers.
    expect(results.reduce((n, r) => n + r, 0)).toBe(2)
  })

  it('does not overwrite a tag somebody set when the dish is ordered again', async () => {
    await order('ZOOP', ['Soya Chaap'])
    const row = await MenuItem.findOne({ tenantId: tenantId(), key: 'soya chaap' })
    expect(row!._id).toBe('ZOOP|soya chaap')
    await setMenuItemDiet(ADMIN, row!._id, 'NON_VEG')
    await order('ZOOP', ['soya chaap'])
    await registerMenuItems(tenantId(), [{ source: 'ZOOP', name: 'Soya Chaap' }])

    const after = await MenuItem.find({ tenantId: tenantId(), key: 'soya chaap' }).lean()
    expect(after).toHaveLength(1)
    expect(after[0].diet).toBe('NON_VEG')
    expect(after[0].reviewed).toBe(true)
  })

  it('counts orders per dish and adds dishes found only in old orders', async () => {
    await order('ZOOP', ['Aloo Paratha'])
    await order('ZOOP', ['aloo  paratha.', 'Dal Fry'])
    // An order from before the menu existed: nothing registered it.
    await MenuItem.deleteMany({ tenantId: tenantId(), key: 'dal fry' })

    const rows = await menuOverview(ADMIN)
    const byName = new Map(rows.map((r) => [`${r.source}|${r.name.toLowerCase()}`, r]))
    expect(byName.get('ZOOP|aloo paratha')).toMatchObject({ orderCount: 2, qty: 4, diet: 'VEG', reviewed: false })
    expect(byName.get('ZOOP|dal fry')).toMatchObject({ orderCount: 1, qty: 2 })
    expect(await MenuItem.countDocuments({ tenantId: tenantId(), key: 'dal fry' })).toBe(1)
  })

  it('confirms suggestions, and a cleared tag reads as untagged', async () => {
    await order('ZOOP', ['Aloo Paratha', 'Egg Roll'])
    const rows = await MenuItem.find({ tenantId: tenantId() }).lean()
    const items = [{ name: 'Egg Roll' }, { name: 'Aloo Paratha' }]
    const before = await dietLookupFor(tenantId(), [{ source: 'ZOOP', items }])
    expect(before.get(menuLookupKey('ZOOP', 'Egg Roll'))).toEqual({ diet: 'NON_VEG', reviewed: false })

    expect(await confirmMenuItems(ADMIN, rows.map((r) => r._id))).toBe(2)
    expect(await MenuItem.countDocuments({ tenantId: tenantId(), reviewed: true })).toBe(2)
    const confirmed = await dietLookupFor(tenantId(), [{ source: 'ZOOP', items }])
    expect(confirmed.get(menuLookupKey('ZOOP', 'Egg Roll'))).toEqual({ diet: 'NON_VEG', reviewed: true })

    await setMenuItemDiet(ADMIN, 'ZOOP|egg roll', null)
    const lookup = await dietLookupFor(tenantId(), [{ source: 'ZOOP', items }])
    expect(lookup.get(menuLookupKey('ZOOP', 'Egg Roll'))).toEqual({ diet: null, reviewed: false })
    expect(lookup.get(menuLookupKey('ZOOP', 'Aloo Paratha'))).toEqual({ diet: 'VEG', reviewed: true })
  })

  it('refuses an id that is not a menu row, whatever shape it arrives in', async () => {
    await order('ZOOP', ['Aloo Paratha'])
    await expect(setMenuItemDiet(ADMIN, 'ZOOP|no such dish', 'VEG')).rejects.toThrow(/Unknown menu item/)
    // A server action argument is whatever the browser sent.
    await expect(setMenuItemDiet(ADMIN, { $ne: null } as unknown as string, 'NON_VEG')).rejects.toThrow(/Unknown menu item/)
    await expect(setMenuItemDiet(ADMIN, 'ZOOP|aloo paratha', 'MEAT' as Diet)).rejects.toThrow(/Unknown tag/)
    expect(await confirmMenuItems(ADMIN, [{ $ne: null } as unknown as string])).toBe(0)
    expect((await MenuItem.findOne({ _id: 'ZOOP|aloo paratha', tenantId: tenantId() }).lean())!.diet).toBe('VEG')
  })

  it('only an admin may tag', async () => {
    await order('ZOOP', ['Aloo Paratha'])
    const row = await MenuItem.findOne({ tenantId: tenantId() })
    const manager: AuthContext = { ...ADMIN, role: 'STORE_MANAGER' }
    await expect(setMenuItemDiet(manager, row!._id, 'NON_VEG')).rejects.toThrow(/admin/)
    await expect(menuOverview(manager)).rejects.toThrow(/admin/)
  })

  it('deletes a dish from the Menu page without it coming back from the orders that carry it', async () => {
    await order('ZOOP', ['Aloo Paratha', 'Egg Curry'])
    await setMenuItemDiet(ADMIN, 'ZOOP|egg curry', 'NON_VEG')
    await removeMenuItem(ADMIN, 'ZOOP|egg curry')

    // Gone from the page, on this read and the next (the page back-fills from orders).
    expect((await menuOverview(ADMIN)).map((r) => r.id)).toEqual(['ZOOP|aloo paratha'])
    expect((await menuOverview(ADMIN)).map((r) => r.id)).toEqual(['ZOOP|aloo paratha'])
    // The order that still carries it keeps its tag for the KOT.
    const lookup = await dietLookupFor(tenantId(), [{ source: 'ZOOP', items: [item('Egg Curry')] }])
    expect(lookup.get('ZOOP|egg curry')).toEqual({ diet: 'NON_VEG', reviewed: true })
  })

  it('brings a deleted dish back, tag as it was, when a new order carries it', async () => {
    await order('ZOOP', ['Egg Curry'])
    await setMenuItemDiet(ADMIN, 'ZOOP|egg curry', 'NON_VEG')
    await removeMenuItem(ADMIN, 'ZOOP|egg curry')
    expect(await menuOverview(ADMIN)).toEqual([])

    await order('ZOOP', ['egg  curry'])
    const rows = await menuOverview(ADMIN)
    expect(rows.map((r) => [r.id, r.diet, r.reviewed, r.orderCount])).toEqual([['ZOOP|egg curry', 'NON_VEG', true, 2]])
    expect(await MenuItem.countDocuments({ tenantId: tenantId() })).toBe(1)
  })

  it('puts a deleted dish back from the Menu page when a newer order carries it and registering was missed', async () => {
    await order('ZOOP', ['Egg Curry'])
    await removeMenuItem(ADMIN, 'ZOOP|egg curry')
    // An order that reached the database without registering its dishes.
    await Order.collection.insertOne({
      tenantId: tenantId(), source: 'ZOOP', status: 'RECEIVED', externalOrderId: 'MENU-RAW', createdAt: new Date(Date.now() + 60_000),
      items: [{ name: 'Egg Curry', qty: 1 }],
    })
    expect((await menuOverview(ADMIN)).map((r) => [r.id, r.orderCount])).toEqual([['ZOOP|egg curry', 2]])
  })

  it('a back-fill from old orders does not put a deleted dish back', async () => {
    await order('ZOOP', ['Egg Curry'])
    await removeMenuItem(ADMIN, 'ZOOP|egg curry')
    await registerMenuItems(tenantId(), [{ source: 'ZOOP', name: 'Egg Curry' }, { source: 'ZOOP', name: 'Dal Fry' }], { restore: false })
    expect((await menuOverview(ADMIN)).map((r) => r.id)).toEqual(['ZOOP|dal fry'])
  })

  it('deleting one aggregator\'s dish leaves the same dish on another', async () => {
    await order('ZOOP', ['Aloo Paratha'])
    await order('OLF', ['Aloo Paratha'])
    await removeMenuItem(ADMIN, 'ZOOP|aloo paratha')
    expect((await menuOverview(ADMIN)).map((r) => r.id)).toEqual(['OLF|aloo paratha'])
  })

  it('restores a deleted dish by hand with the tag given, and only a deleted one', async () => {
    await order('ZOOP', ['Seekh Kebab'])
    expect(await restoreMenuItem(ADMIN, 'ZOOP|seekh kebab', 'Seekh Kebab', 'NON_VEG')).toBe(false)
    await removeMenuItem(ADMIN, 'ZOOP|seekh kebab')
    expect(await restoreMenuItem(ADMIN, 'ZOOP|seekh kebab', 'Seekh Kabab', 'NON_VEG')).toBe(true)
    expect((await menuOverview(ADMIN)).map((r) => [r.id, r.name, r.diet, r.reviewed])).toEqual([['ZOOP|seekh kebab', 'Seekh Kabab', 'NON_VEG', true]])
    expect(await restoreMenuItem(ADMIN, 'ZOOP|never there', 'Never There', 'VEG')).toBe(false)
  })

  it('only an admin may delete, and only a row that exists', async () => {
    await order('ZOOP', ['Aloo Paratha'])
    const manager: AuthContext = { ...ADMIN, role: 'STORE_MANAGER' }
    await expect(removeMenuItem(manager, 'ZOOP|aloo paratha')).rejects.toThrow(/admin/)
    await expect(removeMenuItem(ADMIN, 'ZOOP|no such dish')).rejects.toThrow(/Unknown/)
    await expect(removeMenuItem(ADMIN, { $ne: null } as unknown as string)).rejects.toThrow(/Unknown/)
    expect((await menuOverview(ADMIN)).length).toBe(1)
  })

  it('adds a dish to the menu the moment it is added to an existing order', async () => {
    const o = await order('ZOOP', ['Aloo Paratha'])
    await adminAddOrderItem(ADMIN, String(o._id), { name: 'Egg Curry', qty: '1' })
    expect((await MenuItem.findOne({ _id: 'ZOOP|egg curry', tenantId: tenantId() }).lean())).toMatchObject({ diet: 'NON_VEG', reviewed: false })
    // A packing line added the same way is not a dish.
    await adminAddOrderItem(ADMIN, String(o._id), { name: 'Tissue', qty: '1', isPacking: 'true' })
    expect(await MenuItem.countDocuments({ tenantId: tenantId() })).toBe(2)
  })

  it('adds the new name to the menu when an item is renamed, and keeps the old row', async () => {
    const o = await order('ZOOP', ['Aloo Paratha'])
    const itemId = String((await Order.findOne({ _id: o._id, tenantId: tenantId() }).lean())!.items[0]._id)
    await adminEditOrderItem(ADMIN, String(o._id), itemId, { name: 'Chicken Roll' })
    expect((await MenuItem.find({ tenantId: tenantId() }).sort({ _id: 1 }).lean()).map((r) => [r._id, r.diet])).toEqual([
      ['ZOOP|aloo paratha', 'VEG'],
      ['ZOOP|chicken roll', 'NON_VEG'],
    ])
  })

  it('registers the dishes under the new aggregator when an order is moved to it', async () => {
    const o = await order('ZOOP', ['Aloo Paratha'])
    await adminEditOrder(ADMIN, String(o._id), { source: 'OLF' })
    expect((await MenuItem.find({ tenantId: tenantId() }).sort({ _id: 1 }).lean()).map((r) => r._id)).toEqual([
      'OLF|aloo paratha', 'ZOOP|aloo paratha',
    ])
  })

  it('tags one item on one order without touching the menu', async () => {
    const o = await order('MANUAL', [], {
      orderType: 'BULK', pax: 40, items: [{ name: bulkThaliName(40), qty: 40, spec: 'Dal, rice' }],
    })
    const itemId = String((await Order.findOne({ _id: o._id, tenantId: tenantId() }).lean())!.items[0]._id)
    const changes = await adminEditOrderItem(ADMIN, String(o._id), itemId, { diet: 'NON_VEG' })
    expect(changes).toEqual([{ field: 'diet', label: 'Veg / non-veg', from: null, to: 'NON_VEG' }])

    const saved = (await Order.findOne({ _id: o._id, tenantId: tenantId() }).lean())!
    const lookup = await dietLookupFor(tenantId(), [saved])
    expect(tagFor(lookup, saved.source, saved.items[0])).toEqual({ diet: 'NON_VEG', confirmed: true })
    expect(await MenuItem.countDocuments({ tenantId: tenantId() })).toBe(0)

    // Cleared again, it is back to "not said".
    await adminEditOrderItem(ADMIN, String(o._id), itemId, { diet: '' })
    const cleared = (await Order.findOne({ _id: o._id, tenantId: tenantId() }).lean())!
    expect(tagFor(lookup, cleared.source, cleared.items[0])).toEqual({ diet: null, confirmed: false })
    await expect(adminEditOrderItem(ADMIN, String(o._id), itemId, { diet: 'MEAT' })).rejects.toThrow(/valid/)
  })

  it('never fails an edit because the menu could not catch up', async () => {
    await expect(registerOrderMenu(tenantId(), 'not-an-id')).resolves.toBeUndefined()
    await expect(registerOrderMenu(tenantId(), String(new mongoose.Types.ObjectId()))).resolves.toBeUndefined()
  })
})
