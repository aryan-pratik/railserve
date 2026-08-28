'use client'

import { useNowMs } from './useNow'

function span(mins: number) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/**
 * "in 34m" / "12m ago" — the number the kitchen actually plans against.
 *
 * The absolute arrival time is shown alongside this everywhere it appears; this
 * is the part that answers "do I start now?" without arithmetic.
 */
export function TimeUntil({ at, className = '' }: { at: string | null; className?: string }) {
  const now = useNowMs()

  if (!at) return <span className={`text-sm text-faint ${className}`}>time unknown</span>
  if (now === null) return <span className={`text-sm text-faint ${className}`}>&nbsp;</span>

  const mins = Math.round((new Date(at).getTime() - now) / 60_000)

  if (mins < 0) {
    return <span className={`text-sm font-semibold text-muted ${className}`}>{span(-mins)} ago</span>
  }

  const tone = mins <= 20 ? 'text-red-600' : mins <= 45 ? 'text-amber-700' : 'text-muted'
  return <span className={`text-sm font-semibold ${tone} ${className}`}>in {span(mins)}</span>
}
