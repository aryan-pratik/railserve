import { shiftServiceDate, todayIST } from './format'

/**
 * The one definition of "today" and "how often a screen refreshes" for every
 * operational screen: the kitchen board, the call board and the admin board.
 *
 * Pure and free of the database, so it can be imported from client components
 * and tested against a fixed clock. The query built from it lives in board.ts.
 */

/** Seconds between refreshes on the store, telecaller and admin screens. */
export const REFRESH_SECONDS = 30

/**
 * Until this IST hour, last night's service date still counts as live.
 *
 * A train due at 00:30 belongs to yesterday's service date, and its orders are
 * still open when the calendar rolls over. Dropping them at 00:00 hides food
 * that is about to reach a platform. After this hour whatever is still open
 * from yesterday is stale, and is found under the Yesterday tab instead.
 */
export const ROLLOVER_HOUR_IST = 6

function istHour(now: Date): number {
  const h = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(now)
  return Number(h)
}

/** Whether yesterday's still-open orders are part of the live board right now. */
export function inRollover(now: Date = new Date()): boolean {
  return istHour(now) < ROLLOVER_HOUR_IST
}

/**
 * The service dates whose open orders make up the live board: today, plus
 * yesterday during the past-midnight window. Today first.
 */
export function liveServiceDates(now: Date = new Date()): string[] {
  const today = todayIST(now)
  return inRollover(now) ? [today, shiftServiceDate(today, -1)] : [today]
}
