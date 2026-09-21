/**
 * How urgent a train's arrival is, as one of a few bands.
 *
 * One definition for everything that colours by urgency: the rail down the
 * left of a train card, and the tint on the live board's train header. They
 * are drawn by different components but must agree on where red turns to
 * amber, or one card would show two different answers to "how long have I got".
 */

/** At or under this many minutes to arrival: red. */
export const URGENT_MINUTES = 20
/** At or under this many minutes: amber. Anything later is green. */
export const SOON_MINUTES = 45

export type UrgencyBand = 'red' | 'amber' | 'green' | 'none'

/**
 * `minutes` is until arrival. Unknown, or already arrived, is `none`: urgency
 * colour stops meaning anything once there is nothing left to hurry for, and an
 * unknown time must not read as the calm end of the scale.
 */
export function urgencyBand(minutes: number | null): UrgencyBand {
  if (minutes === null || minutes <= 0) return 'none'
  if (minutes <= URGENT_MINUTES) return 'red'
  if (minutes <= SOON_MINUTES) return 'amber'
  return 'green'
}
