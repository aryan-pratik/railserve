import { formatTimeIST } from '@/lib/format'
import type { TimingView } from '@/lib/train/policy'

export function DelayPill({ delayMinutes }: { delayMinutes: number | null }) {
  if (delayMinutes === null) return null

  if (delayMinutes <= 5) {
    return (
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200">
        on time
      </span>
    )
  }

  const h = Math.floor(delayMinutes / 60)
  const m = delayMinutes % 60
  const label = h > 0 ? `${h}h ${m}m late` : `${m}m late`
  const bad = delayMinutes >= 45

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${
        bad
          ? 'bg-red-100 text-red-800 ring-red-200'
          : 'bg-amber-100 text-amber-800 ring-amber-200'
      }`}
    >
      {label}
    </span>
  )
}

/**
 * Plan §8: "On provider failure, keep the last known value, mark it stale, and
 * show the age in the UI. Never present a stale ETA as live."
 */
export function StaleFlag({ timing }: { timing: TimingView }) {
  if (!timing.stale || timing.ageMinutes === null) return null
  return (
    <span
      className="rounded-full bg-sunken px-2 py-0.5 text-xs font-medium tabular-nums text-muted ring-1 ring-inset ring-line-strong"
      title="The live feed has not updated recently. This is the last known value."
    >
      as of {timing.ageMinutes}m ago
    </span>
  )
}

export function PlatformBadge({ platform }: { platform: string | null }) {
  if (!platform) {
    return (
      <span className="rounded bg-sunken px-2 py-0.5 text-xs font-medium text-faint">
        platform unknown
      </span>
    )
  }
  return (
    <span className="rounded bg-ink px-2 py-0.5 text-xs font-bold tabular-nums text-white">
      PF {platform}
    </span>
  )
}

/** One-line arrival summary: time, live/scheduled, delay, platform, staleness. */
export function TrainTiming({
  timing, showPlatform = true,
}: {
  timing: TimingView
  showPlatform?: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-sm font-semibold tabular-nums text-ink">
        {formatTimeIST(timing.effectiveArrival)}
      </span>
      <span
        className={`rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${
          timing.source === 'LIVE'
            ? 'bg-emerald-600 text-white'
            : 'bg-sunken text-muted'
        }`}
      >
        {timing.source}
      </span>
      <DelayPill delayMinutes={timing.delayMinutes} />
      {showPlatform ? <PlatformBadge platform={timing.platform} /> : null}
      <StaleFlag timing={timing} />
    </div>
  )
}
