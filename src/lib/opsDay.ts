/**
 * The reporting day: 3 a.m. to 3 a.m. IST.
 *
 * A calendar day cuts a night shift in two. A train due at 23:50 that runs
 * forty minutes late is delivered "tomorrow", so the rider's count for the
 * day, the cash they hand over at the end of it and the admin's total for the
 * same date all land on different sides of midnight. At 3 a.m. nothing is
 * moving, so that is where the day turns: everything a rider does between
 * 3 a.m. and the next 3 a.m. is one day's work, and one day's collection.
 *
 * This is the day for anything counted by WHEN IT HAPPENED: deliveries,
 * failures, cash collected, cash handed over. It is not the service date,
 * which is the date on the train booking and stays a calendar date; an order
 * for the 12th delivered at 01:30 on the 13th is still the 12th's order, and
 * falls in the 12th's reporting day as well, which is the point.
 *
 * Pure, so the mobile API, the repositories, the pages and the tests all read
 * one copy. The rider app carries the same three lines in its own source.
 */

/** IST hour at which the reporting day turns. */
export const OPS_DAY_START_HOUR_IST = 3

const IST_OFFSET_MS = 5.5 * 3_600_000
const DAY_MS = 24 * 3_600_000

/** The reporting day ('YYYY-MM-DD') an instant belongs to. */
export function opsDayOf(at: Date = new Date()): string {
  return new Date(at.getTime() + IST_OFFSET_MS - OPS_DAY_START_HOUR_IST * 3_600_000)
    .toISOString()
    .slice(0, 10)
}

/** A reporting day as a [from, to) range of instants, or null for a bad date. */
export function opsDayRange(day: string): { from: Date; to: Date } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const from = new Date(`${day}T${String(OPS_DAY_START_HOUR_IST).padStart(2, '0')}:00:00+05:30`)
  if (Number.isNaN(from.getTime())) return null
  return { from, to: new Date(from.getTime() + DAY_MS) }
}

/** Several consecutive reporting days as one [from, to) range. Inclusive of both ends. */
export function opsDaysRange(fromDay: string, toDay: string): { from: Date; to: Date } | null {
  const a = opsDayRange(fromDay)
  const b = opsDayRange(toDay)
  if (!a || !b || b.to <= a.from) return null
  return { from: a.from, to: b.to }
}

/** "3 am Thu 12 Nov to 3 am Fri 13 Nov", for a caption under a figure. */
export function opsDayCaption(day: string): string {
  const range = opsDayRange(day)
  if (!range) return ''
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' })
  return `3 am ${fmt(range.from)} to 3 am ${fmt(range.to)}`
}
