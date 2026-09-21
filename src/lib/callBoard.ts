import type { CallBoardRowData } from './orderView'

/**
 * Filtering and sectioning for the telecaller's live board.
 *
 * Pure, and kept out of the page, so the rules can be tested against fixed
 * input and so the page reads as "load, filter, section, render".
 */

export type CallState = 'all' | 'todo' | 'done'
export type StatusGroup = 'all' | 'new' | 'preparing' | 'ready' | 'platform'

export type CallFilter = {
  q: string
  call: CallState
  status: StatusGroup
  /** A restaurant id, or '' for every outlet the viewer holds. */
  outlet: string
}

/** The order statuses behind each status chip. Not exhaustive on purpose: a telecaller only works open orders. */
export const STATUS_GROUPS: Record<Exclude<StatusGroup, 'all'>, string[]> = {
  new: ['RECEIVED'],
  preparing: ['ACCEPTED', 'KOT_PRINTED'],
  ready: ['PREPARED'],
  platform: ['DISPATCHED'],
}

export const STATUS_GROUP_LABEL: Record<Exclude<StatusGroup, 'all'>, string> = {
  new: 'New',
  preparing: 'Preparing',
  ready: 'Ready',
  platform: 'On platform',
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''

/** Reads the board's filters off the URL, ignoring anything it does not recognise. */
export function readCallFilter(sp: Record<string, string | string[] | undefined>): CallFilter {
  const call = one(sp.call)
  const status = one(sp.status)
  return {
    q: one(sp.q).trim(),
    call: call === 'todo' || call === 'done' ? call : 'all',
    status: status in STATUS_GROUPS ? (status as StatusGroup) : 'all',
    outlet: one(sp.outlet),
  }
}

export function isFiltered(f: CallFilter): boolean {
  return f.q !== '' || f.call !== 'all' || f.status !== 'all' || f.outlet !== ''
}

/** A passenger is "called" once anyone has written a note against the order. */
export function isCalled(row: Pick<CallBoardRowData, 'lastCall'>): boolean {
  return row.lastCall !== null
}

/**
 * Whether one passenger belongs in the filtered board.
 *
 * The search box is one field over everything a passenger might read out: name,
 * number, order id, seat. Typing a train's number or name keeps every
 * passenger on it, since "12398" means the train, not one person.
 */
export function rowMatches(
  row: CallBoardRowData,
  run: { trainNo: string | null; trainName: string | null },
  f: CallFilter,
): boolean {
  if (f.call === 'todo' && isCalled(row)) return false
  if (f.call === 'done' && !isCalled(row)) return false
  if (f.status !== 'all' && !STATUS_GROUPS[f.status].includes(row.status)) return false

  if (f.q) {
    const needle = f.q.toLowerCase()
    const inTrain = [run.trainNo, run.trainName].some((v) => v?.toLowerCase().includes(needle))
    const inRow = [
      row.contactName,
      row.contactPhone,
      row.externalOrderId,
      row.coach,
      row.berth,
      row.rawSeat,
      row.itemSummary,
    ].some((v) => v?.toLowerCase().includes(needle))
    if (!inTrain && !inRow) return false
  }
  return true
}

export type ArrivalBucket = 'arrived' | 'hour' | 'soon' | 'later' | 'unknown'

/** In display order, which is also the order sortRunsByUrgency already yields. */
export const BUCKET_ORDER: ArrivalBucket[] = ['hour', 'soon', 'later', 'arrived', 'unknown']

export const BUCKET_LABEL: Record<ArrivalBucket, string> = {
  hour: 'Arriving within the hour',
  soon: 'Arriving in 1 to 3 hours',
  later: 'Arriving later',
  arrived: 'Already arrived',
  unknown: 'No arrival time yet',
}

/** Which heading a train sits under, from its real (live) arrival. */
export function arrivalBucket(effectiveArrival: Date | null, now: Date): ArrivalBucket {
  if (!effectiveArrival) return 'unknown'
  const minutes = (effectiveArrival.getTime() - now.getTime()) / 60_000
  if (minutes <= 0) return 'arrived'
  if (minutes <= 60) return 'hour'
  if (minutes <= 180) return 'soon'
  return 'later'
}
