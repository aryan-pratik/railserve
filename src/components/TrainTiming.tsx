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
      // Worth stating, because it will not always equal the gap between the two
      // times shown next to it: this is the railway's figure against the
      // railway's timetable, while the struck-through time came from the
      // aggregator's email. When they disagree, this one is about the train.
      title="How late the railway reports this train, against its own timetable"
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

/**
 * When the railway's own feed last had news.
 *
 * Distinct from StaleFlag, which is our side of it: a reading fetched thirty
 * seconds ago can rest on a position the feed took forty minutes ago, because
 * a train between stations reports nothing. The ETA is only ever as good as
 * this timestamp, so an ETA shown without it is an ETA of unknown age.
 *
 * Rendered as a wall-clock time rather than "12m ago" on purpose: these pages
 * are server-rendered and long-lived on a kitchen screen, and a relative label
 * baked at render silently ages into a lie. An absolute time never does.
 */
export function FeedUpdated({ at }: { at: Date | null }) {
  if (!at) return null
  return (
    <span
      className="text-xs font-medium tabular-nums text-faint"
      title="When the railway feed itself last reported this train. Our own fetch may be newer than this."
    >
      feed {formatTimeIST(at)}
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

/**
 * The time the order was booked against, shown before the live one.
 *
 * Only when the two differ: repeating an unchanged time twice is noise on a
 * board read at a glance. When they do differ it is the whole point — "09:10"
 * alone does not say whether the kitchen planned around 08:39 or 06:35, and
 * that difference is what somebody is actually reacting to.
 *
 * It also makes a real data problem visible. The delay pill is the railway's
 * own figure, measured against ITS timetable, while this time comes from the
 * aggregator's email — and on this route two of them disagree by about two
 * hours. With one number on screen that is invisible; with both, it is obvious.
 */
function WasTime({ timing }: { timing: TimingView }) {
  const was = timing.scheduledArrival
  const now = timing.effectiveArrival
  if (!was || !now || was.getTime() === now.getTime()) return null

  return (
    <>
      <span
        className="text-sm tabular-nums text-faint line-through decoration-faint/60"
        title="The arrival time this order was booked against"
      >
        {formatTimeIST(was)}
      </span>
      <span aria-hidden className="text-xs text-faint">→</span>
    </>
  )
}

/** One-line arrival summary: was → now, live/scheduled, delay, platform, staleness. */
export function TrainTiming({
  timing, showPlatform = true,
}: {
  timing: TimingView
  showPlatform?: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <WasTime timing={timing} />
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
      <FeedUpdated at={timing.providerUpdatedAt} />
    </div>
  )
}
