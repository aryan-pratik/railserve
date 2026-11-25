'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useNavPending } from '@/components/navPending'

/**
 * "Loading…" while a filter, date or tab change is on its way. The page
 * stays where it is until the new one lands (that is how a same-page change
 * works), which reads as a dead click without this. Shown only after a short
 * pause, so quick changes do not flicker.
 */
export function useShowLoading(delayMs = 180): boolean {
  const pending = useNavPending()
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (!pending) {
      const t = setTimeout(() => setShow(false), 0)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setShow(true), delayMs)
    return () => clearTimeout(t)
  }, [pending, delayMs])
  return show
}

export function NavLoadingPill({ show }: { show: boolean }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-none fixed left-1/2 top-24 z-[60] -translate-x-1/2 transition-all duration-200 lg:left-[calc(50%+130px)] ${show ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0'}`}
    >
      <span className="inline-flex items-center gap-2 rounded-full border border-v2-line bg-v2-surface px-4 py-2 text-[13.5px] font-semibold text-v2-ink shadow-v2-pop">
        <Loader2 size={16} className="animate-spin text-v2-brand" aria-hidden />
        {show ? 'Loading…' : ''}
      </span>
    </div>
  )
}
