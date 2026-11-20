/**
 * Veg / non-veg, as the menu database records it.
 *
 * No Mongoose here on purpose, for the same reason as orderEnums.ts: the
 * boards and the KOT are client or shared components and must not drag the
 * driver into the browser bundle.
 *
 * The one rule that matters: an order item is veg or non-veg because the menu
 * database says so (models/MenuItem.ts), looked up by aggregator and item
 * name. Nothing at print time reads the item's name to decide. `suggestDiet`
 * below only pre-fills a NEW menu row, which is then marked "needs check"
 * until somebody confirms it on the Menu page.
 */
export const DIETS = ['VEG', 'NON_VEG'] as const
export type Diet = (typeof DIETS)[number]

export const DIET_LABEL: Record<Diet, string> = { VEG: 'Veg', NON_VEG: 'Non-veg' }

/**
 * Text symbols for plain-text surfaces (copy-to-clipboard, tooltips). The KOT
 * and the screens draw the shape as SVG instead (see DietMark), because a
 * thermal head has no colour and the shape is the whole signal: circle for
 * veg, triangle for non-veg.
 */
export const DIET_SYMBOL: Record<Diet, string> = { VEG: '●', NON_VEG: '▲' }
export const UNTAGGED_SYMBOL = '?'

export function isDiet(v: unknown): v is Diet {
  return v === 'VEG' || v === 'NON_VEG'
}

/**
 * The key a menu row is matched on: "  Majedaar  Aloo Paratha. " and
 * "majedaar aloo paratha" are the same dish. Case, spacing and trailing
 * punctuation vary between one mail and the next from the same aggregator;
 * the words do not, so the words are what is kept. Distinct dishes such as
 * "aloo paratha" and "aloo paratha with soft drink" stay distinct.
 */
export function menuKey(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'.,;:*-]+|[\s"'.,;:*-]+$/g, '')
    .trim()
}

/** One lookup handle for an (aggregator, item) pair. */
export function menuLookupKey(source: string | null | undefined, name: string): string {
  return `${source ?? 'MANUAL'}|${menuKey(name)}`
}

/**
 * Words that make a dish non-veg. Whole words only, so "eggless cake" stays
 * veg and "fisherman" would not match "fish". Kept to words that are never
 * used for a veg dish: "kabab", "seekh" and "biryani" are left out because
 * veg versions of each are common.
 */
const NON_VEG_WORDS = [
  'chicken', 'chiken', 'chikan', 'murg', 'murgh', 'murgi', 'tangdi', 'tangri',
  'mutton', 'lamb', 'goat', 'meat', 'keema', 'kheema', 'qeema',
  'egg', 'eggs', 'anda', 'ande', 'omelette', 'omelet', 'omlet', 'omlette', 'bhurji anda',
  'fish', 'prawn', 'prawns', 'jhinga', 'machli', 'machhli', 'pomfret', 'surmai',
  'nonveg', 'non veg', 'non-veg', 'beef', 'pork', 'ham', 'bacon', 'sausage', 'salami', 'pepperoni',
]
const NON_VEG_RE = new RegExp(`\\b(${NON_VEG_WORDS.map((w) => w.replace(/[-\s]/g, '[-\\s]?')).join('|')})\\b`, 'i')

/**
 * A first guess for a dish the menu has never seen. Used only to pre-fill a
 * new menu row (seed script and new orders), which stays flagged for a person
 * to confirm. Anything without a non-veg word is guessed veg: almost every
 * dish on these menus is, and the Menu page lists the guesses to check.
 */
export function suggestDiet(name: string): Diet {
  return NON_VEG_RE.test(menuKey(name)) ? 'NON_VEG' : 'VEG'
}

/** What a whole order is, for a board that has room for one mark. */
export type OrderDiet = Diet | 'MIXED' | 'UNTAGGED' | null

/**
 * The order's food (packing lines left out) summed up: all veg, all non-veg,
 * both, or something the menu has no tag for. Null when there is no food at
 * all. An untagged item wins over everything, because it is the one that
 * needs a person.
 */
export function orderDietOf(diets: (Diet | null)[]): OrderDiet {
  if (diets.length === 0) return null
  if (diets.some((d) => d === null)) return 'UNTAGGED'
  const veg = diets.includes('VEG')
  const nonVeg = diets.includes('NON_VEG')
  if (veg && nonVeg) return 'MIXED'
  return nonVeg ? 'NON_VEG' : 'VEG'
}

export type DietLookup = ReadonlyMap<string, Diet | null>

/** The diet for one item, or null when the menu has no tag for it. Packing lines are never tagged. */
export function dietFor(
  lookup: DietLookup,
  source: string | null | undefined,
  item: { name: string; isPacking?: boolean | null },
): Diet | null {
  if (item.isPacking) return null
  return lookup.get(menuLookupKey(source, item.name)) ?? null
}

/** Shortcut: the whole order's mark from its items. */
export function orderDiet(
  lookup: DietLookup,
  order: { source?: string | null; items: { name: string; isPacking?: boolean | null }[] },
): OrderDiet {
  return orderDietOf(order.items.filter((i) => !i.isPacking).map((i) => dietFor(lookup, order.source, i)))
}

/**
 * How one order's KOT splits. Non-veg always prints on its own ticket, so an
 * order with any non-veg item and any other food prints two: veg first, then
 * non-veg. Packing lines ride on the first ticket.
 *
 * An item the menu has no tag for is printed on the veg ticket with a "?"
 * beside it rather than being dropped or guessed: the kitchen still cooks it,
 * and the mark tells them to check. The Menu page lists every such item so it
 * can be tagged before it happens again.
 */
export type KotPart<T> = {
  diet: Diet
  /** 1-based, and the count, for "1 of 2" on the ticket. */
  index: number
  of: number
  items: (T & { diet: Diet | null })[]
}

export function splitKotParts<T extends { name: string; isPacking: boolean }>(
  lookup: DietLookup,
  source: string | null | undefined,
  items: T[],
): KotPart<T>[] {
  const tagged = items.map((i) => ({ ...i, diet: dietFor(lookup, source, i) }))
  const nonVeg = tagged.filter((i) => !i.isPacking && i.diet === 'NON_VEG')
  const packing = tagged.filter((i) => i.isPacking)
  const rest = tagged.filter((i) => !i.isPacking && i.diet !== 'NON_VEG')

  // All non-veg (or nothing but non-veg and packing): one ticket.
  if (rest.length === 0 && nonVeg.length > 0) {
    return [{ diet: 'NON_VEG', index: 1, of: 1, items: [...nonVeg, ...packing] }]
  }
  if (nonVeg.length === 0) {
    return [{ diet: 'VEG', index: 1, of: 1, items: [...rest, ...packing] }]
  }
  return [
    { diet: 'VEG', index: 1, of: 2, items: [...rest, ...packing] },
    { diet: 'NON_VEG', index: 2, of: 2, items: nonVeg },
  ]
}

/** How many tickets an order prints: a KOT and a bag slip per part. */
export const TICKETS_PER_PART = 2
