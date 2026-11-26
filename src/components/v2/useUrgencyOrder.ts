'use client'

import { useMemo } from 'react'
import { useNowMs } from '@/components/useNow'
import { sortRunsByUrgency } from '@/lib/runs'

/**
 * Trains in v1's order (lib/runs sortRunsByUrgency), on the same clock as
 * their countdown strips: still to come, soonest first; then arrived, most
 * recent first; then no arrival time. Re-sorted as the clock ticks, so a
 * train that turns red moves up with it, and the order never disagrees with
 * the colours. The first render uses the server's time, like the strips.
 */
export function useUrgencyOrder<T>(items: T[], etaIsoOf: (item: T) => string | null, serverNowMs: number): T[] {
  const now = useNowMs(15_000) ?? serverNowMs
  // A minute is the finest step the strips show; sorting on it keeps the
  // list still between ticks.
  const minute = Math.floor(now / 60_000) * 60_000
  return useMemo(
    () => sortRunsByUrgency(items, (i) => { const iso = etaIsoOf(i); return iso ? new Date(iso) : null }, minute),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, minute],
  )
}
