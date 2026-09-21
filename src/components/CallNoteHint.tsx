'use client'

import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react'
import { IconNote } from './Icons'

/** Per-viewer, per-order: how many notes this browser has already been shown. */
const SEEN_KEY = 'railserve.callNotesSeen'

/** A tooltip takes about this long to appear; hovering that long is reading. */
const READ_AFTER_MS = 600

function rawSeen(): string {
  try {
    return localStorage.getItem(SEEN_KEY) ?? ''
  } catch {
    // Private window or blocked storage. Nothing seen is the safe reading:
    // an unread badge that should have been grey is a far smaller problem
    // than a read badge that should have been red.
    return ''
  }
}

/** Hydration needs a value that cannot differ between server and client. */
function serverSeen(): string {
  return ''
}

function parseSeen(raw: string): Record<string, number> {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {}
  } catch {
    return {}
  }
}

const listeners = new Set<() => void>()

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  // Another tab marking a note read should grey the badge here too.
  window.addEventListener('storage', onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('storage', onChange)
  }
}

/**
 * "This order has been called about" — the count, and whether it is new to you.
 *
 * Read through useSyncExternalStore rather than an effect, because localStorage
 * is exactly the external store it exists for: it gives a stable server
 * snapshot so hydration cannot mismatch, and it keeps this off the wrong side
 * of `react-hooks/set-state-in-effect`, which is an error in this project.
 *
 * "Read" is recorded on a deliberate hover, because on this badge the tooltip
 * *is* the content — there is nothing else to open. A passing cursor does not
 * count; the timer matches roughly how long a browser waits before showing a
 * title tooltip at all, so the note has actually been on screen.
 *
 * Deliberately no pill and no background. It started as one and, being a
 * separate flex item beside the order id in a narrow, wrapping column, it was
 * the thing that wrapped — costing a second line of row height on every noted
 * order across the whole board.
 */
export function CallNoteHint({
  orderId,
  count,
  hint,
}: {
  orderId: string
  count: number | null | undefined
  hint: string | null | undefined
}) {
  const raw = useSyncExternalStore(subscribe, rawSeen, serverSeen)
  const seen = useMemo(() => parseSeen(raw), [raw])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const total = count ?? 0
  const unread = total - (seen[orderId] ?? 0)

  const markRead = useCallback(() => {
    // Re-read rather than trusting the render's snapshot: two badges on one
    // screen must not overwrite each other's entry.
    const next = { ...parseSeen(rawSeen()), [orderId]: total }
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(next))
    } catch {
      // Then it stays unread, which is the harmless direction to fail in.
    }
    for (const notify of listeners) notify()
  }, [orderId, total])

  const startReading = useCallback(() => {
    if (unread <= 0 || timer.current) return
    timer.current = setTimeout(() => {
      timer.current = null
      markRead()
    }, READ_AFTER_MS)
  }, [unread, markRead])

  const stopReading = useCallback(() => {
    if (!timer.current) return
    clearTimeout(timer.current)
    timer.current = null
  }, [])

  if (total < 1 || !hint) return null

  const isUnread = unread > 0
  const label = isUnread
    ? `${unread} unread of ${total} call note${total === 1 ? '' : 's'}`
    : `${total} call note${total === 1 ? '' : 's'}, all read`

  return (
    <span
      title={hint}
      onMouseEnter={startReading}
      onMouseLeave={stopReading}
      className={`inline-flex shrink-0 items-center gap-0.5 text-[11px] font-semibold tabular-nums transition-colors ${
        isUnread ? 'text-red-600' : 'text-faint'
      }`}
    >
      <IconNote size={11} aria-hidden />
      <span aria-hidden>{total}</span>
      <span className="sr-only">{label}</span>
    </span>
  )
}
