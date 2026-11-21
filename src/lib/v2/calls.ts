import type { CallBoardRowData } from '@/lib/orderView'
import { BUCKET_LABEL, BUCKET_ORDER, isCalled, type ArrivalBucket } from '@/lib/callBoard'
import { seatText } from '@/lib/format'
import { sourceLabel } from '@/lib/orderEnums'

/*
 * Shaping for the v2 call board. The filter and bucket rules stay in
 * src/lib/callBoard.ts (shared with v1 and its tests); this only arranges the
 * already-filtered runs into the sections and counts the screen draws.
 */

/** One train on the board, serialised for the client: no Dates, no ObjectIds. */
export type CallsRun = {
  key: string
  trainLabel: string
  trainName: string | null
  stationCode: string
  etaIso: string | null
  bookedIso: string | null
  platform: string | null
  delayMinutes: number | null
  arrived: boolean
  startDateLabel: string | null
  trackingNote: string | null
  bucket: ArrivalBucket
  rows: CallBoardRowData[]
}

export type CallsSection = { bucket: ArrivalBucket; label: string; runs: CallsRun[]; passengers: number }

/** Sections in display order, each with every run that belongs to it (not just this page's). */
export function sectionise(runs: CallsRun[]): CallsSection[] {
  return BUCKET_ORDER.map((bucket) => {
    const own = runs.filter((r) => r.bucket === bucket)
    return { bucket, label: BUCKET_LABEL[bucket], runs: own, passengers: own.reduce((n, r) => n + r.rows.length, 0) }
  }).filter((s) => s.runs.length > 0)
}

/** The RunHeader's status squares for one train's passengers. */
export function runCounts(rows: Pick<CallBoardRowData, 'status'>[]) {
  const c = { fresh: 0, cooking: 0, ready: 0, out: 0, closed: 0 }
  for (const r of rows) {
    if (r.status === 'RECEIVED') c.fresh++
    else if (r.status === 'ACCEPTED' || r.status === 'KOT_PRINTED') c.cooking++
    else if (r.status === 'PREPARED') c.ready++
    else if (r.status === 'DISPATCHED') c.out++
    else c.closed++
  }
  return c
}

export function calledCount(rows: Pick<CallBoardRowData, 'lastCall'>[]): number {
  return rows.filter(isCalled).length
}

/**
 * The row as plain text, for pasting into a message. Same fields the board
 * shows and nothing else: callBoardRow carries no money, so this cannot either.
 */
export function callsCopyText(o: CallBoardRowData, train?: { trainLabel: string; trainName: string | null } | null): string {
  const seat = o.handoverPoint ? `${o.orderType === 'LOCAL' ? 'Deliver to' : 'Handover'}: ${o.handoverPoint}` : seatText(o)
  return [
    `Order ${o.externalOrderId} (${o.orderType})`,
    train ? `Train: ${train.trainLabel}${train.trainName ? ` ${train.trainName}` : ''}` : null,
    o.source ? `Aggregator: ${sourceLabel(o.source)}` : null,
    `Passenger: ${o.contactName ?? '-'}${o.contactPhone ? ` (${o.contactPhone})` : ''}`,
    `Seat: ${seat}`,
    `Items: ${o.itemSummary ?? `${o.itemCount} item${o.itemCount === 1 ? '' : 's'}`}`,
    o.paymentMode ? `Payment: ${o.paymentMode}` : null,
    `Status: ${o.status}`,
  ]
    .filter((l): l is string => l !== null)
    .join('\n')
}

/** Payment mode in a word. Never an amount. */
export function paymentModeLabel(mode: string | null): string | null {
  switch (mode) {
    case 'COD':
      return 'COD'
    case 'PREPAID':
      return 'Prepaid'
    case 'INVOICE':
      return 'Invoice'
    default:
      return mode
  }
}
