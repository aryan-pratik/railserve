'use client'

import { useSyncExternalStore } from 'react'

/**
 * The current time, bucketed to a tick.
 *
 * Bucketing keeps the snapshot referentially stable between reads — returning a
 * fresh Date.now() on every call would spin React forever. Stores are memoised
 * per tick length so every component on the same cadence shares one interval.
 *
 * Returns null during SSR: rendering a clock on the server and again on the
 * client guarantees a mismatch, because time moves between the two. Callers
 * render a placeholder for that first paint.
 */
const stores = new Map<number, { subscribe: (cb: () => void) => () => void; getSnapshot: () => number }>()

function storeFor(tickMs: number) {
  let store = stores.get(tickMs)
  if (!store) {
    store = {
      subscribe: (onChange) => {
        const t = setInterval(onChange, tickMs)
        return () => clearInterval(t)
      },
      getSnapshot: () => Math.floor(Date.now() / tickMs),
    }
    stores.set(tickMs, store)
  }
  return store
}

const getServerSnapshot = () => null

export function useNowMs(tickMs = 30_000): number | null {
  const store = storeFor(tickMs)
  const bucket = useSyncExternalStore(store.subscribe, store.getSnapshot, getServerSnapshot)
  return bucket === null ? null : bucket * tickMs
}
