import type { Outcome } from '@/lib/analytics'

/**
 * The one place an outcome becomes a colour on the Analytics screen: the
 * chart's bars, the tile markers and the table's mix bars all read this, so
 * green means delivered wherever it appears.
 *
 * Chosen as a set and checked for colour-blind separation between
 * neighbours in the stack (delivered, in progress, undelivered, cancelled,
 * other, bottom to top). Changing one hue means re-checking the set. Two of
 * them are too light to stand alone as text, so they only ever fill a mark
 * that sits beside a written label.
 */
export const OUTCOME_FILL: Record<Outcome, string> = {
  delivered: '#1baf7a',
  progress: '#2a78d6',
  undelivered: '#e34948',
  cancelled: '#eda100',
  other: '#6250d6',
}
