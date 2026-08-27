'use client'

import { useSyncExternalStore } from 'react'

const TICK = 15_000
const subscribe = (cb: () => void) => {
  const t = setInterval(cb, TICK)
  return () => clearInterval(t)
}

/**
 * Plan §9: dispatchAt = etaAt − walkToPlatformMinutes − bufferMinutes.
 *
 * The worker records a LEAVE_NOW event so the moment is captured with no
 * browser open; this renders the same computation, counting down.
 *
 * `serverNow` is passed in so the server render and the hydration render agree
 * on the same instant. Without it this could only render a placeholder until
 * mount, which on a phone at a station means the agent stares at an empty grey
 * box exactly when the answer matters most.
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
  const serverBucket = Math.floor(new Date(serverNow).getTime() / TICK)
  const bucket = useSyncExternalStore(
    subscribe,
    () => Math.floor(Date.now() / TICK),
    () => serverBucket,
  )

  if (!dispatchAt) {
    return (
      <div className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600">
        No arrival time known yet, so there is no leave-now time to compute.
      </div>
    )
  }

  const target = new Date(dispatchAt)
  const minsLeft = Math.round((target.getTime() - bucket * TICK) / 60_000)
  const clock = target.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true,
  })

  if (minsLeft <= 0) {
    return (
      <div className="rounded-xl bg-red-600 px-4 py-4 text-center text-white">
        <div className="text-xl font-bold tracking-tight">LEAVE NOW</div>
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
        minsLeft <= 15 ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700'
      }`}
    >
      <div className="text-xs font-semibold uppercase tracking-wide">
        Leave in
      </div>
      <div className="text-2xl font-bold tabular-nums">
        {h > 0 ? `${h}h ${m}m` : `${m}m`}
      </div>
      <div className="mt-0.5 text-xs">
        at {clock} · {platform ? `platform ${platform}` : 'platform unknown'} · walk + buffer subtracted
      </div>
    </div>
  )
}
