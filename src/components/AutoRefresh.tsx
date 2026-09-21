'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { REFRESH_SECONDS } from '@/lib/liveDay'
import { useNowMs } from './useNow'
import { Notice } from './ui'

/** A screen this many refresh cycles old is no longer showing current data. */
const STALE_AFTER_CYCLES = 2

/** Wall-clock time with seconds, so two refreshes 30s apart look different. */
function stamp(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
}

/**
 * Whether the page in front of the user has stopped updating.
 *
 * Staleness is read off the server's render time rather than off whether
 * router.refresh() threw: that call returns nothing and does not report a
 * failed fetch, an offline tab or a timer the browser throttled in the
 * background. What does change on every good refresh is `renderedAt`, so a
 * page whose stamp has stopped moving is stale, whatever the reason.
 */
function useStale(renderedAt: string | undefined, seconds: number): boolean {
  // Null until mounted, so the server render and hydration agree: not stale.
  const nowMs = useNowMs(5_000)
  if (!renderedAt || nowMs === null) return false
  return nowMs - new Date(renderedAt).getTime() > seconds * STALE_AFTER_CYCLES * 1000
}

/**
 * Polling stand-in for the SSE feed. The plan wants a live push with an audible
 * alert; for the MVP a quiet refresh is enough to keep a kitchen screen current
 * without anyone reaching for F5.
 *
 * There is deliberately no pause. This is the only thing that moves a late
 * train's new ETA onto the screen someone is standing in front of, and a paused
 * board is indistinguishable from a quiet one — it keeps showing times that
 * were true when it stopped. A screen that silently goes stale is exactly how a
 * halt gets missed, so the refresh is not the operator's to switch off.
 *
 * Pass `renderedAt` (the server's render time, ISO) to show when the data was
 * read, and to turn the indicator amber when it stops moving.
 */
export function AutoRefresh({
  seconds = REFRESH_SECONDS,
  renderedAt,
}: {
  seconds?: number
  renderedAt?: string
}) {
  const router = useRouter()
  const stale = useStale(renderedAt, seconds)

  useEffect(() => {
    const t = setInterval(() => router.refresh(), seconds * 1000)
    // Browsers slow or freeze timers in a background tab, so a board left on
    // another tab comes back stale. Refresh the moment it is looked at again,
    // and the moment the network returns. Not a pause: only ever more refreshes.
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') router.refresh()
    }
    document.addEventListener('visibilitychange', refreshIfVisible)
    window.addEventListener('online', refreshIfVisible)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', refreshIfVisible)
      window.removeEventListener('online', refreshIfVisible)
    }
  }, [router, seconds])

  return (
    <span
      className={`no-print inline-flex h-7 items-center gap-1.5 px-1 text-xs font-medium ${
        stale ? 'text-amber-800' : 'text-muted'
      }`}
      title={`This screen refreshes itself every ${seconds} seconds`}
    >
      <span
        aria-hidden
        className={`inline-block size-1.5 rounded-full ${
          stale ? 'bg-amber-500' : 'bg-emerald-500 motion-safe:animate-pulse'
        }`}
      />
      <span className="tabular-nums">
        {stale ? 'Not updating' : `Refreshes every ${seconds}s`}
        {renderedAt ? ` · updated ${stamp(renderedAt)}` : ''}
      </span>
    </span>
  )
}

/**
 * The loud half of the stale state. The header indicator is easy to miss on a
 * busy board, so a screen that has stopped updating also says so in the body,
 * where the times it is showing are.
 */
export function StaleNotice({
  renderedAt,
  seconds = REFRESH_SECONDS,
}: {
  renderedAt: string
  seconds?: number
}) {
  const stale = useStale(renderedAt, seconds)
  if (!stale) return null
  return (
    <Notice tone="warn">
      This screen has not updated since <strong className="tabular-nums">{stamp(renderedAt)}</strong>. Arrival times
      and order statuses below may be out of date. Check your connection; it keeps retrying.
    </Notice>
  )
}
