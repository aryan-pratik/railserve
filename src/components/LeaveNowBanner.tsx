'use client'

import { useNowMs } from './useNow'

const TICK = 15_000

/**
 * Plan §9: dispatchAt = etaAt − walkToPlatformMinutes − bufferMinutes.
 *
 * The worker records a LEAVE_NOW event so the moment is captured with no
 * browser open; this renders the same computation, counting down.
 *
 * The shared clock is null until mount, so `serverNow` stands in for that first
 * paint and the server render and the hydration render agree on the same
 * instant. Without it this could only render a placeholder until mount, which on
 * a phone at a station means the agent stares at an empty grey box exactly when
 * the answer matters most.
 */
export function LeaveNowBanner({
  dispatchAt, platform, trainNo, orderCount, serverNow,
}: {
  dispatchAt: string | null
  platform: string | null
  trainNo: string | null
  orderCount: number
  serverNow: string
}) {
  const nowMs = useNowMs(TICK) ?? Math.floor(new Date(serverNow).getTime() / TICK) * TICK

  if (!dispatchAt) {
    return (
      <div className="rounded-xl border border-line bg-sunken px-4 py-3 text-sm text-muted">
        No arrival time known yet, so there is no leave-now time to compute.
      </div>
    )
  }

  const target = new Date(dispatchAt)
  const minsLeft = Math.round((target.getTime() - nowMs) / 60_000)
  const clock = target.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true,
  })

  if (minsLeft <= 0) {
    return (
      <div className="rounded-xl bg-red-600 px-4 py-4 text-center text-white">
        <div className="text-2xl font-bold tracking-tight">LEAVE NOW</div>
        <div className="mt-0.5 text-sm">
          {trainNo} · {orderCount} order{orderCount === 1 ? '' : 's'} ·{' '}
          {platform ? `platform ${platform}` : 'platform unknown'}
        </div>
      </div>
    )
  }

  const h = Math.floor(minsLeft / 60)
  const m = minsLeft % 60

  return (
    <div
      className={`rounded-xl px-4 py-4 text-center ${
        minsLeft <= 15 ? 'bg-amber-100 text-amber-900' : 'border border-line bg-sunken text-muted'
      }`}
    >
      <div className="text-xs font-semibold uppercase tracking-wider">
        Leave in
      </div>
      {/* The one number an agent reads at arm's length on a platform. */}
      <div className="text-3xl font-bold leading-tight tabular-nums">
        {h > 0 ? `${h}h ${m}m` : `${m}m`}
      </div>
      <div className="mt-0.5 text-xs tabular-nums">
        at {clock} · {platform ? `platform ${platform}` : 'platform unknown'} · walk + buffer subtracted
      </div>
    </div>
  )
}
