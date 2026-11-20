import { describe, expect, it } from 'vitest'
import { MENU_CATEGORIES, menuCategory } from '../src/lib/menuCategory'

describe('menuCategory', () => {
  it.each([
    ['Veg Thali', 'Thali and meals'], ['Non Veg Thali', 'Thali and meals'], ['Tandoori Platter', 'Thali and meals'],
    ['Paneer Paratha Combo', 'Combos'], ['Soya Keema Pav Combo (veg)', 'Combos'],
    ['Chicken Biryani', 'Biryani'], ['Veg Biryani', 'Biryani'],
    ['Chicken Fried Rice', 'Chinese'], ['Veg Momos', 'Chinese'], ['Hakka Noodles', 'Chinese'],
    ['Masala Dosa', 'South Indian'], ['Idli Sambar', 'South Indian'],
    ['Gulab Jamun', 'Desserts'], ['Eggless Cake', 'Desserts'],
    ['Masala Chai', 'Beverages'], ['Mineral Water', 'Beverages'], ['Tea', 'Beverages'],
    ['Chicken Roll', 'Snacks and breakfast'], ['Paneer Tikka', 'Snacks and breakfast'], ['Chole Bhature', 'Snacks and breakfast'],
    ['Anda Bhurji', 'Snacks and breakfast'],
    ['Dal Makhani', 'Curries and mains'], ['Butter Chicken', 'Curries and mains'], ['Chicken Curry with 4 Roti', 'Curries and mains'],
    ['Egg Curry with Rice', 'Curries and mains'], ['Rajma Chawal', 'Curries and mains'], ['Fish Fry', 'Curries and mains'],
    ['Paneer Butter Masala', 'Curries and mains'], ['Soya Chaap', 'Curries and mains'],
    ['Veg Pulao', 'Rice and pulao'], ['Jeera Rice', 'Rice and pulao'],
    ['Aloo Paratha', 'Breads'], ['Majedaar Aloo Paratha', 'Breads'], ['Butter Naan', 'Breads'], ['Tandoori Roti', 'Breads'],
    // What comes before "with" names the dish.
    ['Aloo Paratha with Soft Drink', 'Breads'], ['Paneer Paratha', 'Breads'],
    ['Curd', 'Sides'], ['Boondi Raita', 'Sides'],
    ['Nanda Special', 'Other'], ['-', 'Other'],
  ])('%s is under %s', (name, category) => {
    expect(menuCategory(name)).toBe(category)
  })

  it('only ever returns a listed section', () => {
    expect(new Set(MENU_CATEGORIES).size).toBe(MENU_CATEGORIES.length)
    for (const n of ['Veg Thali', 'xyz', 'Tea', '']) expect(MENU_CATEGORIES).toContain(menuCategory(n))
  })
})
