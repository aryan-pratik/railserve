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
 * (dietSuggest.ts) only pre-fills a NEW menu row, which stays "not confirmed" until
 * somebody confirms it on the Menu page, and every ticket and screen says so
 * while it is.
 *
 * The one exception to "by name" is an item that is not a dish at all: a
 * bulk thali is one line called "Bulk thali × 40" whose food is in its `spec`.
 * Those are tagged on the order itself (`items[].diet`), never through the
 * menu. See tagFor.
 */
import { ORDER_SOURCES, type OrderSource } from './orderEnums'

export const DIETS = ['VEG', 'NON_VEG'] as const
export type Diet = (typeof DIETS)[number]

export const DIET_LABEL: Record<Diet, string> = { VEG: 'Veg', NON_VEG: 'Non-veg' }

/**
 * Text symbols for plain-text surfaces (copy-to-clipboard, script output). The
 * KOT and the screens draw the shape as SVG instead (see DietMark), because a
 * thermal head has no colour and the shape is the whole signal: circle for
 * veg, triangle for non-veg.
 */
export const DIET_SYMBOL: Record<Diet, string> = { VEG: '●', NON_VEG: '▲' }
export const UNTAGGED_SYMBOL = '?'

export function isDiet(v: unknown): v is Diet {
  return v === 'VEG' || v === 'NON_VEG'
}

/** Anything that is not one of our aggregators is filed with the hand-entered orders. */
export function menuSource(source: string | null | undefined): OrderSource {
  return (ORDER_SOURCES as readonly string[]).includes(source ?? '') ? (source as OrderSource) : 'MANUAL'
}

/**
 * The key a menu row is matched on: "  Majedaar  Aloo Paratha. " and
 * "majedaar aloo paratha" are the same dish. Case, spacing, the kind of dash
 * or quote and trailing punctuation vary between one mail and the next from
 * the same aggregator; the words do not, so the words are what is kept.
 * Distinct dishes such as "aloo paratha" and "aloo paratha with soft drink"
 * stay distinct.
 *
 * Stored keys are compared verbatim, so changing this after the menu has been
 * seeded orphans the rows it changes.
 */
export function menuKey(name: string): string {
  const folded = name
    .normalize('NFKC')
    .toLowerCase()
    // Zero-width characters and soft hyphens: invisible, and mail clients add them.
    .replace(/[​-‍⁠­﻿]/g, '')
    .replace(/[‘’`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  const stripped = folded.replace(/^[\s"'.,;:*-]+|[\s"'.,;:*-]+$/g, '').trim()
  // A name that is nothing but punctuation ("-") still needs a key of its
  // own, or it could never be given a row and so never be tagged.
  return stripped || folded
}

/**
 * The one line a bulk order carries: its name counts plates, its food is in
 * `spec`. Both bulk forms name it through here, and isMenuDish reads the name
 * back, so the menu never grows a "dish" called "Bulk thali × 40" and another
 * called "Bulk thali × 41".
 */
export function bulkThaliName(pax: number): string {
  return `Bulk thali × ${pax}`
}

const BULK_THALI_NAME = /^bulk thali [×x] ?\d+$/

/** One lookup handle for an (aggregator, item) pair. Also the menu row's _id. */
export function menuLookupKey(source: string | null | undefined, name: string): string {
  return `${menuSource(source)}|${menuKey(name)}`
}

/* ── reading the tag ──────────────────────────────────────────────────────── */

/** One menu row as the lookup carries it. `reviewed` is false while the tag is only a suggestion. */
export type MenuTag = { diet: Diet | null; reviewed: boolean }
export type DietLookup = ReadonlyMap<string, MenuTag>

export type ItemLike = {
  name: string
  isPacking?: boolean | null
  /** The composite menu of a thali. An item with one is not a dish the menu can name. */
  spec?: string | null
  /** Set on the order itself; wins over the menu. */
  diet?: string | null
}

/** A tag, and whether a person stands behind it. */
export type ItemTag = { diet: Diet | null; confirmed: boolean }

/**
 * The tag for one item.
 *
 * - Set on the order itself (`item.diet`): that, confirmed.
 * - A composite item (see isMenuDish): untagged until set on the order. Its
 *   name is not a dish, so the menu cannot know.
 * - Otherwise the menu row for (aggregator, name): its tag, confirmed only
 *   once somebody has reviewed it. No row means untagged.
 *
 * Packing lines are never tagged.
 */
export function tagFor(lookup: DietLookup, source: string | null | undefined, item: ItemLike): ItemTag {
  if (item.isPacking) return { diet: null, confirmed: true }
  if (isDiet(item.diet)) return { diet: item.diet, confirmed: true }
  if (!isMenuDish(item)) return { diet: null, confirmed: false }
  const row = lookup.get(menuLookupKey(source, item.name))
  if (!row || !row.diet) return { diet: null, confirmed: false }
  return { diet: row.diet, confirmed: row.reviewed }
}

/** Just the diet, for callers that do not show whether it is confirmed. */
export function dietFor(lookup: DietLookup, source: string | null | undefined, item: ItemLike): Diet | null {
  return tagFor(lookup, source, item).diet
}

/**
 * True when the item is a dish the menu database should hold a row for.
 * Not packing, and not composite: an item with a `spec` (the food is listed
 * there, not in the name) or the bulk thali line itself.
 */
export function isMenuDish(item: ItemLike): boolean {
  if (item.isPacking) return false
  if (item.spec && item.spec.trim()) return false
  return !BULK_THALI_NAME.test(menuKey(item.name))
}

/**
 * What a whole order is, for a board that has room for one mark.
 *
 * UNTAGGED: something has no tag and nothing is known to be non-veg.
 * NON_VEG_UNTAGGED: something has no tag, and something else is non-veg, so
 * the triangle must still show.
 */
export type OrderDiet = Diet | 'MIXED' | 'UNTAGGED' | 'NON_VEG_UNTAGGED' | null

/** The order's food (packing lines left out) summed up. Null when there is no food at all. */
export function orderDietOf(diets: (Diet | null)[]): OrderDiet {
  if (diets.length === 0) return null
  const veg = diets.includes('VEG')
  const nonVeg = diets.includes('NON_VEG')
  if (diets.some((d) => d === null)) return nonVeg ? 'NON_VEG_UNTAGGED' : 'UNTAGGED'
  if (veg && nonVeg) return 'MIXED'
  return nonVeg ? 'NON_VEG' : 'VEG'
}

/** Shortcut: the whole order's mark from its items. */
export function orderDiet(
  lookup: DietLookup,
  order: { source?: string | null; items: ItemLike[] },
): OrderDiet {
  return orderDietOf(order.items.filter((i) => !i.isPacking).map((i) => dietFor(lookup, order.source, i)))
}

/* ── the KOT split ────────────────────────────────────────────────────────── */

/**
 * How one order's KOT splits. Non-veg always prints on its own ticket, so an
 * order with any non-veg item and any other food prints two: veg first, then
 * non-veg. Packing lines ride on the first ticket.
 *
 * An item with no tag is printed on the veg ticket with a "?" beside it
 * rather than being dropped or guessed: the kitchen still cooks it, and the
 * mark tells them to check. A tag that is only a suggestion decides the split
 * like any other, and prints with a "?" after its shape until confirmed.
 */
export type KotPart<T> = {
  diet: Diet
  /** 1-based, and the count, for "1 of 2" on the ticket. */
  index: number
  of: number
  items: (T & ItemTag)[]
}

export function splitKotParts<T extends ItemLike & { isPacking: boolean }>(
  lookup: DietLookup,
  source: string | null | undefined,
  items: T[],
): KotPart<T>[] {
  // The tag is spread last so it replaces the item's own stored `diet`.
  const tagged = items.map((i) => ({ ...i, ...tagFor(lookup, source, i) }))
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

/** How many tickets one part prints: a KOT and a bag slip. */
export const TICKETS_PER_PART = 2
