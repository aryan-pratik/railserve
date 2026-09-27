/**
 * Rider location tracking: the numbers and the rules, in one place.
 *
 * The rider app, the ingest route and the admin board all have to agree on
 * what "live" means. Left to each of them they would drift — the app posting
 * every 30s against a board calling anything over 20s offline shows a working
 * rider as missing, which is worse than showing nothing at all. So the
 * cadences and the thresholds are defined here together, and the relationship
 * between them (a rider is only stale after several missed posts) is visible
 * rather than coincidental.
 */

/**
 * How often the rider app sends whatever fixes it has collected.
 *
 * Shorter than the interval at which fixes are *taken* (10s, or 15 metres
 * moved), which is deliberate: a send with an empty buffer costs no request at
 * all, so a tight sender only ever shortens the gap between a rider moving and
 * the board showing it. The GPS is the expensive part and its cadence is set
 * separately, on the phone.
 */
export const PING_INTERVAL_SECONDS = 5

/** How often the admin board asks the server for fresh positions. */
export const BOARD_REFRESH_SECONDS = 5

/**
 * Positions kept per rider for drawing the recent path.
 *
 * At one fix every ~10s this is roughly the last 15 minutes of movement —
 * enough to see which way someone is walking along a platform, and small
 * enough that the whole board is one modest query.
 */
export const TRAIL_MAX_POINTS = 90

/**
 * Most fixes one request may carry. A reconnecting phone flushes a backlog,
 * and a background batch arrives several fixes at a time.
 */
export const MAX_PINGS_PER_REQUEST = 240

/**
 * A fix older than this is not worth storing. A phone that was off overnight
 * would otherwise flush yesterday's walk and redraw a trail nobody wants.
 */
export const MAX_PING_AGE_MINUTES = 60

/**
 * Device clocks are wrong. A fix stamped further ahead than this is treated as
 * skew and clamped to the moment the server received it, because a future
 * timestamp would pin a rider as permanently "just now" and block every real
 * fix behind it (the store only advances on a strictly newer stamp).
 */
export const MAX_CLOCK_SKEW_MINUTES = 2

export const PRESENCE = ['LIVE', 'IDLE', 'OFFLINE', 'NEVER'] as const
export type Presence = (typeof PRESENCE)[number]

/**
 * Newer than this and the dot on the map is where the rider is.
 *
 * An absolute floor, not a multiple of the send interval. Tying it to the
 * cadence made sense at 20s, but at 5s it would call a rider offline after
 * twenty seconds — and a phone on a platform loses signal for that long
 * routinely. This is about how long a gap is still normal, which does not get
 * shorter just because the app talks more often.
 */
const LIVE_WITHIN_SECONDS = 45

/** Older than this and the position is history, not a location. */
const IDLE_WITHIN_SECONDS = 10 * 60

export const PRESENCE_LABEL: Record<Presence, string> = {
  LIVE: 'Live',
  IDLE: 'Idle',
  OFFLINE: 'Offline',
  NEVER: 'Never shared',
}

export const PRESENCE_NOTE: Record<Presence, string> = {
  LIVE: 'Sending position now.',
  IDLE: 'Last position is a few minutes old — the phone may be asleep or out of signal.',
  OFFLINE: 'Nothing received for over ten minutes. The position shown is where they last were.',
  NEVER: 'This rider has never shared a position. They may be on an older build of the app, or have declined the permission.',
}

/**
 * How current a rider's last fix is.
 *
 * Deliberately three grades rather than a boolean. "Offline" and "somewhere
 * around here five minutes ago" are different answers to "where is this
 * rider", and collapsing them makes a marker that is merely a little behind
 * look as untrustworthy as one from an hour ago.
 */
export function presenceOf(recordedAt: Date | string | null | undefined, now: Date = new Date()): Presence {
  if (!recordedAt) return 'NEVER'
  const ageSeconds = (now.getTime() - new Date(recordedAt).getTime()) / 1000
  if (ageSeconds <= LIVE_WITHIN_SECONDS) return 'LIVE'
  if (ageSeconds <= IDLE_WITHIN_SECONDS) return 'IDLE'
  return 'OFFLINE'
}

/** "just now" / "4m ago" / "2h ago". Empty string for nothing to age. */
export function ageLabel(recordedAt: Date | string | null | undefined, now: Date = new Date()): string {
  if (!recordedAt) return ''
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(recordedAt).getTime()) / 1000))
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/** Metres per second as the speed a person reads. Null when the fix had none. */
export function speedLabel(metresPerSecond: number | null | undefined): string | null {
  if (metresPerSecond === null || metresPerSecond === undefined || metresPerSecond < 0) return null
  // Under a slow walk, "0.4 km/h" is noise in the GPS rather than movement.
  if (metresPerSecond < 0.4) return 'Stationary'
  return `${(metresPerSecond * 3.6).toFixed(1)} km/h`
}

/** Compass point, for saying which way someone is heading without a needle. */
export function headingLabel(degrees: number | null | undefined): string | null {
  if (degrees === null || degrees === undefined || Number.isNaN(degrees)) return null
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return points[Math.round((((degrees % 360) + 360) % 360) / 45) % 8]
}

/** One position as it travels from the phone to the database and on to the board. */
export type LocationFix = {
  lat: number
  lng: number
  accuracyMetres: number | null
  speedMetresPerSecond: number | null
  headingDegrees: number | null
  recordedAt: Date
}
