import { SOON_MINUTES, URGENT_MINUTES } from '../urgency'
/**
 * Minutes-to-arrival is the one loud colour in v2. Everything that needs to
 * shout about time (run strips, countdown chips, the sidebar tile) asks here,
 * so the thresholds live in one place. They become tenant settings later.
 */
export type Urgency = 'calm' | 'soon' | 'urgent' | 'over'

// The same bands as v1 (lib/urgency), so both boards agree on when a train
// turns amber and red: green over 45 minutes, amber 21-45, red at 20 or less.
export const URGENCY_SOON_MINUTES = SOON_MINUTES
export const URGENCY_URGENT_MINUTES = URGENT_MINUTES

export function urgencyFor(minutesToArrival: number | null, arrived = false): Urgency {
  if (arrived) return 'over'
  if (minutesToArrival === null) return 'calm'
  if (minutesToArrival <= 0) return 'over'
  if (minutesToArrival <= URGENCY_URGENT_MINUTES) return 'urgent'
  if (minutesToArrival <= URGENCY_SOON_MINUTES) return 'soon'
  return 'calm'
}

export function minutesUntil(target: Date | string | null, now: number): number | null {
  if (!target) return null
  const t = typeof target === 'string' ? Date.parse(target) : target.getTime()
  if (!Number.isFinite(t)) return null
  return Math.round((t - now) / 60_000)
}

/** "19 min", "1 h 08", "now", "12 min ago". */
export function countdownLabel(minutes: number | null, arrived = false): string {
  if (arrived) return 'at platform'
  if (minutes === null) return 'no ETA'
  if (minutes <= 0 && minutes > -1) return 'now'
  if (minutes < 0) {
    const m = -minutes
    return m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} ago`
  }
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`
}

/**
 * Three bands, the ones the kitchen already reads: green = time in hand,
 * amber = cook now, red = at the door or gone. `urgent` and `over` share the
 * red; only `over` pulses.
 */
export const URGENCY_FILL: Record<Urgency, string> = {
  calm: 'bg-v2-brand text-white',
  soon: 'bg-v2-soon text-[#1a1200]',
  urgent: 'bg-v2-over text-white',
  over: 'bg-v2-over text-white v2-pulse',
}

export const URGENCY_BG: Record<Urgency, string> = {
  calm: 'bg-v2-brand',
  soon: 'bg-v2-soon',
  urgent: 'bg-v2-over',
  over: 'bg-v2-over',
}

/** "6h 17m late" / "on time", for the ETA line. */
export function delayLabel(delayMinutes: number | null | undefined): string | null {
  if (delayMinutes === null || delayMinutes === undefined) return null
  if (delayMinutes <= 5) return 'on time'
  const h = Math.floor(delayMinutes / 60)
  const m = delayMinutes % 60
  return `${h ? `${h}h ` : ''}${m}m late`
}

/** The band's two lines: ["6h 0m", "AGO"] / ["19 min", "IN"] / ["NOW", ""] / ["—", "NO ETA"]. */
export function bandLabel(minutes: number | null, arrived = false): [string, string] {
  if (minutes === null) return ['—', 'time unknown']
  const abs = Math.abs(minutes)
  const text = abs < 60 ? `${abs} min` : `${Math.floor(abs / 60)}h ${abs % 60}m`
  if (minutes <= 0 && minutes > -1 && !arrived) return ['now', 'at platform']
  if (minutes < 0 || (arrived && minutes <= 0)) return [text, 'ago']
  return [text, arrived ? 'arrived' : 'left']
}

/**
 * A train's countdown strip, exactly as v1 drew it (components/UrgencyRail):
 *
 * - still to come: green over 45 minutes, amber 21 to 45, red at 20 or less,
 *   reading "47 / MIN" or "2h / 13m", and "NOW / DUE" at the minute itself;
 * - arrived: amber for the first 20 minutes (delivery is likely still going
 *   on), then no colour at all, reading "1h 39m / AGO", so a train that has
 *   come and gone never shouts louder than one still on its way;
 * - no arrival time: grey, "? / NO ETA", never the calm green.
 *
 * Decided by the clock alone, as in v1, so the colour always agrees with the
 * order the trains are listed in (lib/runs sortRunsByUrgency).
 */
export function stripStyle(minutesToArrival: number | null): { fill: string; big: string; small: string } {
  const RED = 'bg-red-600 text-white'
  const AMBER = 'bg-amber-500 text-[#0d1424]'
  const GREEN = 'bg-emerald-700 text-white'
  const NONE = 'bg-transparent text-v2-muted'
  if (minutesToArrival === null) return { fill: 'bg-[#c9cfda] text-[#0d1424]', big: '?', small: 'no eta' }
  const m = minutesToArrival
  if (m < 0) return { fill: m >= -URGENT_MINUTES ? AMBER : NONE, big: span(-m), small: 'ago' }
  const fill = m <= URGENT_MINUTES ? RED : m <= SOON_MINUTES ? AMBER : GREEN
  if (m === 0) return { fill, big: 'now', small: 'due' }
  return m >= 60 ? { fill, big: `${Math.floor(m / 60)}h`, small: `${m % 60}m` } : { fill, big: String(m), small: 'min' }
}

/** "45m", "2h 13m", "13h": never "809m". As v1. */
function span(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m}m`
  if (h < 10) return `${h}h ${m}m`
  return `${h}h`
}
