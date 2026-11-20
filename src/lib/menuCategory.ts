/**
 * Which section of a restaurant menu a dish belongs under: Thali, Biryani,
 * Breads, Beverages and so on. Used only to lay the Menu page out the way a
 * printed menu reads. It decides nothing else: veg / non-veg comes from the
 * tag on the menu row, never from here.
 *
 * Worked out from the name each time and not stored, so improving a rule
 * regroups every dish at once. Client-safe: plain `\b` patterns only.
 */
import { menuKey } from './diet'

/** In the order a menu lists them. The first rule a name matches wins. */
const RULES: [string, RegExp][] = [
  ['Thali and meals', /\b(thali|thaali|meals?|platter|tiffin)\b/],
  ['Combos', /\bcombos?\b/],
  ['Biryani', /\b(biryani|biriyani|briyani|biriani)\b/],
  ['Chinese', /\b(noodles?|chowmein|chow mein|hakka|manchurian|fried rice|schezwan|szechwan|momos?|chilli (chicken|paneer|potato)|spring rolls?)\b/],
  ['South Indian', /\b(dosa|idli|idly|vada|uttapam|uthappam|sambar|upma|pongal)\b/],
  ['Desserts', /\b(gulab jamun|rasgulla|rasmalai|kheer|halwa|ice ?cream|sweets?|cake|pastry|jalebi|kulfi|brownie|laddu|ladoo|barfi)\b/],
  ['Beverages', /\b(tea|chai|coffee|lassi|juice|water|soft drink|cold drink|drinks?|shake|buttermilk|chaas|chhach|soda|milk|cola)\b/],
  ['Snacks and breakfast', /\b(sandwich|burger|pizza|rolls?|wrap|samosa|pakora|pakoda|tikka|kabab|kebab|cutlet|omelette|omelet|bhurji|poha|maggi|pav bhaji|vada pav|chole bhature|bhature|chole kulche|puri sabji|puri sabzi|poori|fries|nuggets|lollipop|chaat|tikki|toast|pasta|soup)\b/],
  ['Curries and mains', /\b(curry|masala|makhani|korma|kurma|kadai|kadhai|karahi|kofta|dal|daal|rajma|chole|chana|sabzi|sabji|bhaji|rogan josh|butter chicken|handi|saag|palak|matar|mutter|gravy|do pyaza|bharta|keema|fry)\b/],
  ['Rice and pulao', /\b(rice|pulao|pulav|chawal|khichdi)\b/],
  ['Breads', /\b(roti|chapati|chapathi|naan|nan|paratha|parantha|kulcha|puri|phulka|bread)\b/],
  ['Sides', /\b(curd|dahi|raita|salad|papad|pickle|achar|chutney)\b/],
  ['Curries and mains', /\b(paneer|chicken|mutton|fish|egg|anda|aloo|gobi|mushroom|soya|chaap)\b/],
]

export const OTHER_CATEGORY = 'Other'

/** Every section name, in menu order, for filters and for sorting. */
export const MENU_CATEGORIES: string[] = [...new Set(RULES.map(([name]) => name)), OTHER_CATEGORY]

function match(text: string): string | null {
  for (const [name, re] of RULES) if (re.test(text)) return name
  return null
}

/**
 * The section for one dish name. "Aloo Paratha with Soft Drink" is a bread,
 * not a beverage: what comes before "with" names the dish, so it is tried
 * first and the whole name only if that says nothing.
 */
export function menuCategory(name: string): string {
  const text = menuKey(name)
  const head = text.split(/\s+(?:with|and|n)\s+|\s*[+&]\s*/)[0] ?? text
  return match(head) ?? match(text) ?? OTHER_CATEGORY
}
