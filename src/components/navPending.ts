'use client'

import { useEffect, useSyncExternalStore, useTransition } from 'react'

/**
 * One flag for "a navigation is in flight".
 *
 * App Router only shows loading.tsx when the route segment changes. A filter,
 * a tab or a date pill changes the search params of the page you are already
 * on, and for those the old screen simply sits there until the new one lands.
 * On a slow link that reads as a dead click, so people click again.
 *
 * Every control that pushes a URL runs it through useNavTransition(); the
 * shell reads the flag and draws a progress bar. A module-level store rather
 * than context, so a toolbar deep in a server-rendered tree can report
 * without a provider above it.
 */
let inflight = 0
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

const getSnapshot = () => inflight > 0
const getServerSnapshot = () => false

/** True while any control's navigation transition is still pending. */
export function useNavPending(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/**
 * useTransition, plus reporting into the shared flag.
 *
 * router.push inside startTransition keeps `pending` true until the new page
 * has actually committed, which is the honest definition of "still loading".
 */
export function useNavTransition(): [boolean, (fn: () => void) => void] {
  const [pending, start] = useTransition()

  useEffect(() => {
    if (!pending) return
    inflight += 1
    emit()
    return () => {
      inflight = Math.max(0, inflight - 1)
      emit()
    }
  }, [pending])

  return [pending, start]
}
