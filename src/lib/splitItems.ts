/**
 * Some aggregators write a whole order on one line:
 *
 *   2x Veg Maharaja Thali, 3x Butter Tawa Roti
 *
 * A parser that reads only the leading quantity turns that into one item
 * called "Veg Maharaja Thali, 3x Butter Tawa Roti". The kitchen then sees
 * one dish where there are two, and the menu database gets a row that is not
 * a dish at all. This takes such a name apart again.
 *
 * The cut is made only at a comma followed by "<number> x <name>", which is
 * how a second item starts and not something a dish name contains.
 */

const NEXT_ITEM = /\s*[,;]\s*(?=\d{1,3}\s*[x×]\s+\S)/i
const QTY_NAME = /^(\d{1,3})\s*[x×]\s+(.+)$/i

const tidy = (s: string) => s.replace(/\s+/g, ' ').replace(/[\s,.;]+$/, '').trim()

/** True when the name holds more than one item. */
export function isCombinedName(name: string | null | undefined): boolean {
  return splitCombinedName(name ?? '').rest.length > 0
}

/**
 * "Veg Maharaja Thali, 3x Butter Tawa Roti" gives the first dish's name and
 * the items that were riding on it. A plain name comes back as itself with
 * nothing in `rest`.
 */
export function splitCombinedName(name: string): { first: string; rest: { name: string; qty: number }[] } {
  const chunks = name.split(NEXT_ITEM)
  if (chunks.length < 2) return { first: name, rest: [] }
  const first = tidy(chunks[0])
  const rest: { name: string; qty: number }[] = []
  for (const chunk of chunks.slice(1)) {
    const m = QTY_NAME.exec(chunk.trim())
    const qty = m ? Number(m[1]) : 0
    const part = m ? tidy(m[2]) : ''
    // Anything that does not read as "<n> x <name>" after all: leave the
    // whole name alone rather than guess.
    if (!m || qty < 1 || !part) return { first: name, rest: [] }
    rest.push({ name: part, qty })
  }
  if (!first) return { first: name, rest: [] }
  return { first, rest }
}

type ItemShape = { name?: unknown; isPacking?: unknown; spec?: unknown }

/**
 * An order's items with every combined one taken apart. The first dish keeps
 * the item as it was (its quantity, price, note and tag); the ones that were
 * riding on it become items of their own with the quantity written before
 * them. Packing lines and composite items (a bulk thali's menu text) are
 * left alone.
 */
export function splitCombinedItems<T extends ItemShape>(items: T[]): (T | { name: string; qty: number })[] {
  const out: (T | { name: string; qty: number })[] = []
  for (const item of items) {
    const spec = typeof item.spec === 'string' ? item.spec.trim() : ''
    if (typeof item.name !== 'string' || item.isPacking === true || spec) {
      out.push(item)
      continue
    }
    const { first, rest } = splitCombinedName(item.name)
    if (rest.length === 0) {
      out.push(item)
      continue
    }
    out.push({ ...item, name: first }, ...rest)
  }
  return out
}
