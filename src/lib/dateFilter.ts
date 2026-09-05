/**
 * Shared "date filter" semantics for admin screens that scope orders by
 * `serviceDate`: Today, This month, a chosen month, or an explicit range.
 *
 * A screen that also needs "no filter at all" (the /admin/orders lookup)
 * adds its own 'all' mode on top — resolveDateRange returns blank bounds for
 * it, which every caller here already treats as unbounded.
 */

import { todayIST } from './format'

export type DateFilterMode = 'all' | 'today' | 'month' | 'custom-month' | 'range'

export const DATE_FILTER_OPTIONS: { value: DateFilterMode; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'month', label: 'This month' },
  { value: 'custom-month', label: 'Custom month' },
  { value: 'range', label: 'Custom range' },
]

/** First and last day of a 'YYYY-MM' month, as 'YYYY-MM-DD' strings. */
function monthBounds(monthValue: string): { from: string; to: string } {
  const [y, m] = monthValue.split('-').map(Number)
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${monthValue}-01`, to: `${monthValue}-${String(lastDay).padStart(2, '0')}` }
}

/**
 * Turns a DateFilter mode + its raw params into a concrete `serviceDate`
 * range. Blank `from`/`to` in 'range' mode pass through unchanged — several
 * callers (the /admin/orders lookup) rely on a blank bound meaning
 * unbounded, not "default to today".
 */
export function resolveDateRange(
  mode: string,
  opts: { month?: string; from?: string; to?: string },
): { from: string; to: string; month: string } {
  const today = todayIST()
  const currentMonth = today.slice(0, 7)

  switch (mode) {
    case 'today':
      return { from: today, to: today, month: currentMonth }
    case 'month':
      return { ...monthBounds(currentMonth), month: currentMonth }
    case 'custom-month': {
      const month = opts.month || currentMonth
      return { ...monthBounds(month), month }
    }
    case 'range':
      return { from: opts.from ?? '', to: opts.to ?? '', month: currentMonth }
    case 'all':
    default:
      return { from: '', to: '', month: currentMonth }
  }
}
