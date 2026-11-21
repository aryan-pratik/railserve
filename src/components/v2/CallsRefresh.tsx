'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useNowMs } from '@/components/useNow'
import { Notice } from './Table'
import { cx } from './ui'

/** A screen this many refresh cycles old is no longer showing current data. */
const STALE_AFTER_CYCLES = 2
export const CALLS_REFRESH_SECONDS = 30

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
 * Staleness is read off the server's render time, not off whether
 * router.refresh() threw: that call reports nothing. A stamp that has stopped
 * moving is stale, whatever the reason.
 */
function useStale(renderedAt: string, seconds: number): boolean {
  // Null until mounted, so the server render and hydration agree: not stale.
  const nowMs = useNowMs(5_000)
  if (nowMs === null) return false
  return nowMs - new Date(renderedAt).getTime() > seconds * STALE_AFTER_CYCLES * 1000
}

/**
 * The call board's quiet refresh. No pause on purpose: a paused board is
 * indistinguishable from a quiet one. A background tab refreshes the moment
 * it is looked at again, and when the network returns.
 */
export function CallsRefresh({ renderedAt, seconds = CALLS_REFRESH_SECONDS }: { renderedAt: string; seconds?: number }) {
  const router = useRouter()
  const stale = useStale(renderedAt, seconds)

  useEffect(() => {
    const t = setInterval(() => router.refresh(), seconds * 1000)
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
      className={cx('inline-flex h-8 items-center gap-1.5 text-xs font-semibold', stale ? 'text-v2-warn' : 'text-v2-muted')}
      title={`This screen refreshes itself every ${seconds} seconds`}
    >
      <span aria-hidden className={cx('inline-block h-2 w-2 rounded-full', stale ? 'bg-v2-soon' : 'bg-v2-brand shadow-[0_0_0_3px_var(--color-v2-brand-soft)]')} />
      <span className="tabular-nums">{stale ? 'Not updating' : 'Live'} · updated {stamp(renderedAt)}</span>
    </span>
  )
}

/** The loud half: in the body, where the times it is warning about are. */
export function CallsStaleNotice({ renderedAt, seconds = CALLS_REFRESH_SECONDS }: { renderedAt: string; seconds?: number }) {
  const stale = useStale(renderedAt, seconds)
  if (!stale) return null
  return (
    <Notice tone="warn">
      This screen has not updated since <strong className="tabular-nums">{stamp(renderedAt)}</strong>. Arrival times and statuses below may be out of
      date. Check your connection; it keeps retrying.
    </Notice>
  )
}
