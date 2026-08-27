'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Polling stand-in for the SSE feed. The plan wants a live push with an audible
 * alert; for the MVP a quiet refresh is enough to keep a kitchen screen current
 * without anyone reaching for F5.
 */
export function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter()
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (paused) return
    const t = setInterval(() => router.refresh(), seconds * 1000)
    return () => clearInterval(t)
  }, [router, seconds, paused])

  return (
    <button
      type="button"
      onClick={() => setPaused((p) => !p)}
      className="no-print flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800"
      title={paused ? 'Resume auto-refresh' : 'Pause auto-refresh'}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          paused ? 'bg-slate-300' : 'animate-pulse bg-emerald-500'
        }`}
      />
      {paused ? 'Paused' : `Live · every ${seconds}s`}
    </button>
  )
}
