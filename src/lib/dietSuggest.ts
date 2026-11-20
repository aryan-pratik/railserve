/**
 * The first guess for a dish the menu database has never seen.
 *
 * Kept apart from diet.ts on purpose. diet.ts is imported by client
 * components, and the patterns here use look-behind, which older Safari
 * refuses to parse at all: one of these in a browser bundle would blank the
 * page on an old phone. Only the server (menuRepo), the seed script and the
 * tests import this file.
 *
 * Nothing here runs at print time. The guess is written once, onto a new menu
 * row, and stays "not confirmed" until a person confirms it on the Menu page.
 */
import { menuKey, type Diet } from './diet'

const SEP = '[\\s._/-]*'

/** "Non veg", "Non-Vegetarian", "Non - Veg", "N.Veg", "NV": the menu saying so itself. */
const NON_VEG_MARKER = new RegExp(`(?<![a-z])(non${SEP}veg(etarian)?|n\\.veg|nv)(?![a-z])`, 'i')

/** The aggregator's own "(veg)" at the end of a name, as BrotherByte writes every dish. */
const VEG_SUFFIX = /\((pure )?veg(etarian)?\)\s*$/i

/** Phrases that carry a non-veg word and mean the opposite, or nothing: removed before the words are looked for. */
const NOT_MEAT = new RegExp(
  [`egg${SEP}less`, `egg${SEP}free`, `no${SEP}egg`, `without${SEP}egg`, `egg${SEP}plant`].join('|'),
  'gi',
)

/**
 * Words that make a dish non-veg. Whole words only (a letter on either side
 * blocks the match, a digit does not, so "Chicken65" counts and "Fisherman"
 * does not). Kept to words that are not used for veg dishes; the ones that
 * are ("kabab", "biryani", "tandoori") are in AMBIGUOUS below instead.
 * Spellings are the ones kitchens and aggregators actually type.
 */
const NON_VEG_WORDS = [
  'chicken', 'chiken', 'chikan', 'chikken', 'chickan', 'chkn', 'murg', 'murgh', 'murga', 'murgi', 'murgha', 'kukkad',
  'tangdi', 'tangri', 'mutton', 'muttan', 'mattan', 'lamb', 'goat', 'bakra', 'gosht', 'meat', 'keema', 'kheema', 'qeema',
  'kaleji', 'nihari', 'bheja', 'rogan josh',
  'egg', 'eggs', 'anda', 'andaa', 'ande', 'anday', 'andey', 'omelette', 'omelet', 'omelete', 'omlet', 'omlette', 'omlate',
  'amlet', 'aamlet',
  'fish', 'machli', 'machhli', 'machhi', 'machi', 'macchi', 'maach', 'rohu', 'katla', 'hilsa', 'ilish', 'bangda',
  'pomfret', 'surmai', 'prawn', 'prawns', 'jhinga', 'jheenga', 'shrimp', 'crab', 'kekda',
  'beef', 'pork', 'ham', 'bacon', 'sausage', 'salami', 'pepperoni',
]
const NON_VEG_RE = new RegExp(`(?<![a-z])(${NON_VEG_WORDS.map((w) => w.replace(/ /g, SEP)).join('|')})(?![a-z])`, 'i')

/** The same words in Devanagari, where \b and letter look-arounds do not apply. */
const NON_VEG_HINDI = ['चिकन', 'मुर्ग', 'मटन', 'अंडा', 'अण्डा', 'अंडे', 'मछली', 'मीट', 'गोश्त', 'कीमा', 'नॉन वेज', 'नॉनवेज']

/** A word before the meat word that makes it a veg dish: "Soya Keema", "Veg Omelette". */
const MOCK_BEFORE = new RegExp(
  `(?<![a-z])(veg|vegetable|soya|soy|mock|besan|paneer|jackfruit|kathal)${SEP}(${NON_VEG_WORDS.join('|')})(?![a-z])`,
  'i',
)

/**
 * Dishes that are usually meat but have common veg versions, so the name
 * alone cannot say. These get no suggestion unless the name also says veg.
 */
const AMBIGUOUS = new RegExp(
  `(?<![a-z])(biryani|biriyani|briyani|kabab|kebab|kabob|seekh|sheekh|tikka|tandoori|lollipop|leg${SEP}piece|drums${SEP}of${SEP}heaven|mughlai|zinger|half${SEP}fry|handi|shawarma|momo|momos)(?![a-z])`,
  'i',
)

/** Words that settle an ambiguous dish as veg: "Veg Biryani", "Paneer Tikka", "Hara Bhara Kabab". */
const VEG_WORDS = new RegExp(
  `(?<![a-z])(veg|vegetable|vegetarian|jain|paneer|aloo|alu|gobi|gobhi|mushroom|soya|soy|chaap|hara${SEP}bhara|dal|daal|rajma|chole|chana|kathal|jackfruit|corn|palak|matar|subz|subji|sabji|sabzi)(?![a-z])`,
  'i',
)

/** "Tandoori Roti" is bread from a tandoor, not a tandoori dish. */
const TANDOOR_BREAD = new RegExp(`(?<![a-z])tandoori${SEP}(butter${SEP})?(roti|naan|nan|paratha|parantha|kulcha|bread)(?![a-z])`, 'i')

/**
 * A first guess for a dish the menu has never seen: VEG, NON_VEG, or null
 * when the name does not say. Used only to pre-fill a new menu row (seed
 * script and new orders), which stays "not confirmed" until a person confirms
 * it. Never called at print time.
 *
 * `hint` is anything else the order says about the item (its notes). It can
 * only ever take a veg guess away, never add a tag: a note is one
 * passenger's, the menu row is every passenger's.
 */
export function suggestDiet(name: string, hint?: string | null): Diet | null {
  const text = menuKey(name)
  if (NON_VEG_MARKER.test(text)) return 'NON_VEG'
  if (NON_VEG_HINDI.some((w) => text.includes(w))) return 'NON_VEG'
  if (VEG_SUFFIX.test(text)) return 'VEG'

  const cleaned = text.replace(NOT_MEAT, ' ')
  if (NON_VEG_RE.test(cleaned)) {
    // "Soya Keema" is veg, "Veg Fish Fry" and "Eggless Omelette" probably
    // are: the name argues with itself, so a person decides.
    return MOCK_BEFORE.test(cleaned) || cleaned !== text ? null : 'NON_VEG'
  }
  if (AMBIGUOUS.test(cleaned.replace(TANDOOR_BREAD, ' ')) && !VEG_WORDS.test(cleaned)) return null
  if (hint) {
    const h = menuKey(hint).replace(NOT_MEAT, ' ')
    if (NON_VEG_RE.test(h) || NON_VEG_MARKER.test(h)) return null
  }
  return 'VEG'
}

