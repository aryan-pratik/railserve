'use client'

import { useNowMs } from './useNow'

function describe(msRemaining: number): { text: string; tone: string } {
  const late = msRemaining < 0
  const abs = Math.abs(msRemaining)
  const mins = Math.floor(abs / 60000)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  const span = h > 0 ? `${h}h ${m}m` : `${m}m`

  if (late) return { text: `${span} overdue`, tone: 'bg-red-100 text-red-800 ring-red-200' }
  if (mins <= 30) return { text: `in ${span}`, tone: 'bg-amber-100 text-amber-800 ring-amber-200' }
  return { text: `in ${span}`, tone: 'bg-sunken text-muted ring-line' }
}

/**
 * Shown only when readyBy is set — which in practice means bulk orders. Retail
 * has no promised kitchen time, and a countdown to nothing is just noise.
 */
export function ReadyByCountdown({ readyBy }: { readyBy: string }) {
  // null on the server: rendering a countdown during SSR and again on the client
  // guarantees a mismatch, because time moves between the two.
  const nowMs = useNowMs(30_000)

  if (nowMs === null) {
    return (
      <span className="rounded-full bg-sunken px-2 py-0.5 text-xs font-medium text-faint ring-1 ring-inset ring-line">
        ready by …
      </span>
    )
  }

  const { text, tone } = describe(new Date(readyBy).getTime() - nowMs)
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ring-1 ring-inset ${tone}`}>
      ready {text}
    </span>
  )
}
