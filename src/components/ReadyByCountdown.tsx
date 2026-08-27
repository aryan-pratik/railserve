'use client'

import { useSyncExternalStore } from 'react'

function describe(msRemaining: number): { text: string; tone: string } {
  const late = msRemaining < 0
  const abs = Math.abs(msRemaining)
  const mins = Math.floor(abs / 60000)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  const span = h > 0 ? `${h}h ${m}m` : `${m}m`

  if (late) return { text: `${span} overdue`, tone: 'bg-red-100 text-red-800 ring-red-200' }
  if (mins <= 30) return { text: `in ${span}`, tone: 'bg-amber-100 text-amber-800 ring-amber-200' }
  return { text: `in ${span}`, tone: 'bg-slate-100 text-slate-700 ring-slate-200' }
}

const TICK_MS = 30_000

function subscribe(onChange: () => void) {
  const t = setInterval(onChange, TICK_MS)
  return () => clearInterval(t)
}

// Bucketed to the tick so the snapshot is referentially stable between reads —
// returning a fresh Date.now() every call would spin React forever.
const getSnapshot = () => Math.floor(Date.now() / TICK_MS)

// null on the server: rendering a countdown during SSR and again on the client
// guarantees a mismatch, because time moves between the two.
const getServerSnapshot = () => null

/**
 * Shown only when readyBy is set — which in practice means bulk orders. Retail
 * has no promised kitchen time, and a countdown to nothing is just noise.
 */
export function ReadyByCountdown({ readyBy }: { readyBy: string }) {
  const bucket = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  if (bucket === null) {
    return (
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-400 ring-1 ring-inset ring-slate-200">
        ready by …
      </span>
    )
  }

  const { text, tone } = describe(new Date(readyBy).getTime() - bucket * TICK_MS)
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${tone}`}>
      ready {text}
    </span>
  )
}
