'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

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
 */
export function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter()

  useEffect(() => {
    const t = setInterval(() => router.refresh(), seconds * 1000)
    return () => clearInterval(t)
  }, [router, seconds])

  return (
    <span
      className="no-print inline-flex items-center gap-2 px-2 py-1 text-xs font-medium text-muted"
      title={`This board refreshes itself every ${seconds} seconds`}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 motion-safe:animate-pulse" />
      <span className="tabular-nums">Live · every {seconds}s</span>
    </span>
  )
}
