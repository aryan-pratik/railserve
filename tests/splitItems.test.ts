import { beforeEach, describe, expect, it } from 'vitest'
import { isCombinedName, splitCombinedItems, splitCombinedName } from '../src/lib/splitItems'
import { OlfParser } from '../src/lib/ingest/parsers/olf'
import { insertOrder } from '../src/lib/repo/orderRepo'
import { MenuItem } from '../src/lib/models'
import { resetDb } from './fixtures'

/**
 * An order line "2x Veg Maharaja Thali, 3x Butter Tawa Roti" is two dishes.
 * It must never reach the kitchen, or the menu database, as one item named
 * "Veg Maharaja Thali, 3x Butter Tawa Roti".
 */

describe('splitCombinedName', () => {
  it.each([
    ['Amritsari Thali, 1x Plain Tawa Roti', 'Amritsari Thali', [['Plain Tawa Roti', 1]]],
    ['Special Veg Thali, 6x Plain Tawa Roti', 'Special Veg Thali', [['Plain Tawa Roti', 6]]],
    ['Veg Mini Thali, 1x Chhola Rice Combo', 'Veg Mini Thali', [['Chhola Rice Combo', 1]]],
    ['Special Egg Thali, 1x Paneer Curry With Roti Combo', 'Special Egg Thali', [['Paneer Curry With Roti Combo', 1]]],
    ['Veg Thali,2 x Roti , 3X Lassi.', 'Veg Thali', [['Roti', 2], ['Lassi', 3]]],
    ['Veg Thali; 2 × Roti', 'Veg Thali', [['Roti', 2]]],
  ])('%s', (name, first, rest) => {
    expect(splitCombinedName(name)).toEqual({ first, rest: rest.map(([n, qty]) => ({ name: n, qty })) })
    expect(isCombinedName(name)).toBe(true)
  })

  it.each([
    'Aloo Paratha With Curd Combo',
    'Dal, Rice and Roti',
    'Chicken 65, Dry',
    'Paneer Tikka (6 pcs), with chutney',
    'Roti, 2 pieces',
    'Thali, 2x',
    'Maggi 2x Masala',
    'Combo, 0x Nothing',
    '',
  ])('leaves "%s" alone', (name) => {
    expect(splitCombinedName(name)).toEqual({ first: name, rest: [] })
    expect(isCombinedName(name)).toBe(false)
  })
})

describe('splitCombinedItems', () => {
  it('keeps the first dish as the item was and adds the rest with their own quantity', () => {
    const items = [
      { _id: 'a', name: 'Veg Maharaja Thali, 3x Butter Tawa Roti', qty: 2, pricePaise: 30000, notes: 'less spicy' },
      { _id: 'b', name: 'Lassi', qty: 1 },
    ]
    expect(splitCombinedItems(items)).toEqual([
      { _id: 'a', name: 'Veg Maharaja Thali', qty: 2, pricePaise: 30000, notes: 'less spicy' },
      { name: 'Butter Tawa Roti', qty: 3 },
      { _id: 'b', name: 'Lassi', qty: 1 },
    ])
    // An item with nothing to split is handed back as the same object.
    expect(splitCombinedItems(items)[2]).toBe(items[1])
  })

  it('leaves packing lines and composite items alone', () => {
    const items = [
      { name: 'Spoon, 2x Tissue', qty: 1, isPacking: true },
      { name: 'Bulk thali × 40', qty: 40, spec: 'Dal, 2x Roti, rice' },
      { name: 'Thali, 2x Roti', qty: 1, spec: 'with curd' },
    ]
    expect(splitCombinedItems(items)).toEqual(items)
  })
})

describe('combined items on a new order', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('OLF: a line of several items parses into several items', () => {
    const body = [
      '*OLF*', 'You Recieved a new order from OLF.',
      '*✅IRCTC order ID* :- 2481128752', '*✅Customer Name* :- Arth Singh', '*📱Mobile No.* :- 7300972260',
      '*🚊Train Name & Number*:-  SFG MCTM SF EXP 22432', '*✅Coach & Birth No*:- M2 46',
      '*📅Delivery Date*:- 08-31-2026 09:55 IST', '*✅Delivery Station* :- KANPUR CENTRAL',
      '*✅Items* :- 2x Veg Maharaja Thali, 3x Butter Tawa Roti',
      '*✅Amount* :- Rs. 583 only', '*✅Payment Mode*:- CASH_ON_DELIVERY', '*❇️Customer Comment* :- less oil',
    ].join('\n')
    const res = new OlfParser().parse(body, new Date())
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.order.items).toEqual([
      { name: 'Veg Maharaja Thali', qty: 2, notes: 'less oil' },
      { name: 'Butter Tawa Roti', qty: 3, notes: null },
    ])
  })

  it('is split when the order is saved, whatever made it, and each dish gets its own menu row', async () => {
    const o = await insertOrder({
      source: 'RELFOOD', orderType: 'RETAIL', externalOrderId: 'SPLIT-1', status: 'RECEIVED',
      stationCode: 'CNB', serviceDate: '2026-11-20',
      items: [{ name: 'Special Egg Thali, 1x Non Veg Mini Thali', qty: 2 }, { name: 'Lassi', qty: 1 }],
    })
    expect(o.items.map((i) => [i.name, i.qty])).toEqual([
      ['Special Egg Thali', 2], ['Non Veg Mini Thali', 1], ['Lassi', 1],
    ])
    expect((await MenuItem.find({}).sort({ _id: 1 }).lean()).map((r) => r._id)).toEqual([
      'RELFOOD|lassi', 'RELFOOD|non veg mini thali', 'RELFOOD|special egg thali',
    ])
  })
})
