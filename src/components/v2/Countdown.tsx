'use client'

import { useNowMs } from '@/components/useNow'
import { bandLabel, countdownLabel, minutesUntil, urgencyFor, URGENCY_FILL } from '@/lib/v2/urgency'
import { cx } from './ui'

/**
 * A live "arrives in" chip. Ticks every 15s on the client; the first paint
 * uses the server's clock so hydration matches.
 */
export function Countdown({
  targetIso,
  arrived = false,
  serverNowMs,
  className,
  size = 'md',
}: {
  targetIso: string | null
  arrived?: boolean
  serverNowMs: number
  className?: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const now = useNowMs(15_000) ?? serverNowMs
  const minutes = minutesUntil(targetIso, now)
  const urgency = urgencyFor(minutes, arrived)
  const sizing =
    size === 'lg' ? 'px-3 py-1 text-sm' : size === 'sm' ? 'px-2 py-px text-[11px]' : 'px-2 py-0.5 text-xs'
  return (
    <span
      className={cx('inline-flex items-center gap-1.5 rounded-lg font-mono font-semibold tabular-nums', sizing, URGENCY_FILL[urgency], className)}
    >
      {countdownLabel(minutes, arrived)}
    </span>
  )
}

/** The big number in the sidebar tile: "00:19" style, minutes and seconds. */
export function CountdownClock({ targetIso, serverNowMs }: { targetIso: string | null; serverNowMs: number }) {
  const now = useNowMs(1_000) ?? serverNowMs
  if (!targetIso) return <span className="font-mono text-3xl font-semibold tabular-nums">--:--</span>
  const diff = Math.max(0, Math.round((Date.parse(targetIso) - now) / 1000))
  const h = Math.floor(diff / 3600)
  const m = Math.floor((diff % 3600) / 60)
  const s = diff % 60
  const text = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return <span className="font-mono text-3xl font-semibold tabular-nums tracking-tight">{text}</span>
}

/**
 * The coloured band at the head of a run: the countdown in large type on the
 * urgency colour, the way the v1 train card showed it. Live on the client.
 */
export function CountdownBand({ targetIso, arrived = false, serverNowMs, className }: { targetIso: string | null; arrived?: boolean; serverNowMs: number; className?: string }) {
  const now = useNowMs(15_000) ?? serverNowMs
  const minutes = minutesUntil(targetIso, now)
  const urgency = urgencyFor(minutes, arrived)
  const [big, small] = bandLabel(minutes, arrived)
  return (
    <div className={cx('grid content-center justify-items-center gap-0.5 px-2 text-center', URGENCY_FILL[urgency].replace(' v2-pulse', ''), className)}>
      <span className="font-mono text-[17px] font-semibold leading-tight tabular-nums">{big}</span>
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] opacity-85">{small}</span>
    </div>
  )
}
