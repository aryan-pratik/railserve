import type { OrderDiet } from '@/lib/diet'
import type { OrderStatus } from '@/lib/orderStatus'
import { formatRupees, formatShortDate, formatTimeIST, seatText } from '@/lib/format'

/*
 * The kitchen board's row and run shapes, and the pure helpers over them.
 * No Mongoose here: these cross into client components (the run card, the
 * wall, the ticket actions), so everything is plain JSON-safe data.
 */

export type KitchenDay = 'today' | 'yesterday' | 'upcoming'

export const KITCHEN_DAYS: { key: KitchenDay; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'upcoming', label: 'Upcoming' },
]

/**
 * Where an order stands, as a kitchen asks it. With none picked the board
 * shows what it always has: every open order on Today and Upcoming, the whole
 * night on Yesterday. Delivered and cancelled orders are reachable only
 * through their own chip, so a finished order never crowds the open ones.
 */
export const KITCHEN_STATUS_FILTERS: { key: string; label: string; statuses: OrderStatus[] }[] = [
  { key: 'live', label: 'Live', statuses: ['RECEIVED', 'ACCEPTED', 'KOT_PRINTED', 'PREPARED'] },
  { key: 'platform', label: 'On platform', statuses: ['DISPATCHED'] },
  {
    key: 'returned',
    label: 'Cancelled / returned',
    statuses: ['CANCELLED', 'FAILED', 'LOST', 'MISDELIVERY', 'MISSED_DELIVERY', 'REFUNDED'],
  },
  { key: 'delivered', label: 'Delivered', statuses: ['DELIVERED'] },
]

export type KitchenOrder = {
  id: string
  externalOrderId: string
  orderType: string
  source: string | null
  status: string
  coach: string | null
  berth: string | null
  rawSeat: string | null
  handoverPoint: string | null
  pax: number | null
  contactName: string | null
  /** Masked for the board; the full number lives on the order workspace. */
  contactPhone: string | null
  /** One label per dish, packing left out: "Veg Thali ×2". */
  itemNames: string[]
  diet: OrderDiet
  amountPaise: number | null
  paymentMode: string | null
  /** Only set when the viewer sees more than one outlet. */
  outletName: string | null
  /** Instruction the kitchen must read: Order.kotNote, else remark. */
  note: string | null
  receivedAtIso: string
  placedLabel: string
  callNoteCount: number
  callNoteHint: string | null
}

export type KitchenRunCounts = { fresh: number; cooking: number; ready: number; out: number; closed: number }

export type KitchenRun = {
  key: string
  local: boolean
  trainNo: string | null
  trainLabel: string
  trainName: string | null
  stationCode: string
  serviceDate: string
  etaIso: string | null
  bookedIso: string | null
  platform: string | null
  delayMinutes: number | null
  arrived: boolean
  /** Scheduled, not live: the feed had nothing for this train. */
  timetableOnly: boolean
  /** When the first bag must leave the counter. */
  leaveByIso: string | null
  /** "Started 20 Nov" when the train set off on another day. */
  startDateLabel: string | null
  /** "arrived · tracking stopped", "checked 14:20 · next 15:20", "timetable". */
  trackingNote: string | null
  counts: KitchenRunCounts
  /** Per raw status, for the next-step footer. */
  statusCounts: Record<string, number>
  codTotalPaise: number
  itemCount: number
  orders: KitchenOrder[]
}

export function countsFor(statuses: string[]): KitchenRunCounts {
  const n = (pred: (s: string) => boolean) => statuses.filter(pred).length
  return {
    fresh: n((s) => s === 'RECEIVED'),
    cooking: n((s) => s === 'ACCEPTED' || s === 'KOT_PRINTED'),
    ready: n((s) => s === 'PREPARED'),
    out: n((s) => s === 'DISPATCHED'),
    closed: n((s) => !['RECEIVED', 'ACCEPTED', 'KOT_PRINTED', 'PREPARED', 'DISPATCHED'].includes(s)),
  }
}

const DIET_TEXT: Record<Exclude<OrderDiet, null>, string> = {
  VEG: 'veg',
  NON_VEG: 'non-veg',
  MIXED: 'veg + non-veg',
  UNTAGGED: 'veg/non-veg not tagged',
  NON_VEG_UNTAGGED: 'non-veg + an item not tagged',
}

/** Everything a row shows, as plain text for pasting into a chat. */
export function kitchenOrderText(o: KitchenOrder, run: KitchenRun): string {
  const seat = o.handoverPoint
    ? `${o.orderType === 'LOCAL' ? 'Deliver to' : 'Handover'}: ${o.handoverPoint}`
    : seatText(o)
  const items = o.pax ? `${o.pax} pax thali` : o.itemNames.join(', ') || 'No items'
  const lines = [
    `Order ${o.externalOrderId} (${o.orderType})`,
    `Passenger: ${o.contactName ?? '-'}${o.contactPhone ? ` (${o.contactPhone})` : ''}`,
    `Seat: ${seat}`,
    `Items: ${items}${o.diet ? ` (${DIET_TEXT[o.diet]})` : ''}`,
    `Amount: ${formatRupees(o.amountPaise)}${o.paymentMode ? ` (${o.paymentMode})` : ''}`,
    o.note ? `Note: ${o.note}` : null,
    `Status: ${o.status}`,
    `Placed: ${o.placedLabel}`,
    run.local ? `Local · ${run.stationCode}` : `Train: ${run.trainLabel} ${run.trainName ?? ''} · ${run.stationCode}`.trim(),
  ]
  return lines.filter((l): l is string => l !== null).join('\n')
}

/** The train as one line, for the run header's copy button. */
export function kitchenRunText(run: KitchenRun): string {
  return `${run.trainLabel} ${run.trainName ?? ''} · ${run.stationCode}`.trim()
}

/** The one next step a set of orders is waiting on, in pipeline order. */
export type NextStep = 'accept' | 'print' | 'ready' | 'hand' | null

export function nextStepFor(statuses: string[]): NextStep {
  if (statuses.includes('RECEIVED')) return 'accept'
  if (statuses.includes('ACCEPTED')) return 'print'
  if (statuses.includes('KOT_PRINTED')) return 'ready'
  if (statuses.includes('PREPARED')) return 'hand'
  return null
}

export function formatDelay(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`
}

/**
 * Hash target for a run. The sidebar tile links `/v2/kitchen#<runKey>`, and
 * the key is URL-safe and has no spaces (see runs.ts SEP), so it is the id.
 */
export function runAnchor(runKey: string): string {
  return runKey
}

/** The pieces of a timing read the run header turns into words. */
export type RunTimingNotes = {
  arrived: boolean
  source: 'LIVE' | 'SCHEDULED'
  checkedAt: Date | string | null
  nextCheckAt: Date | string | null
  startDate: Date | string | null
}

function ymdIST(d: Date | string): string {
  if (typeof d === 'string') return d.slice(0, 10)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d)
}

/** "Started 20 Nov" when the train's start date is not the service date. */
export function startDateLabelFor(startDate: Date | string | null | undefined, serviceDate: string): string | null {
  if (!startDate) return null
  const ymd = ymdIST(startDate)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd) || ymd === serviceDate) return null
  return `Started ${formatShortDate(ymd).replace(/^[A-Za-z]{3} /, '')}`
}

/** What the ETA rests on, under it: stopped, when it was last asked, or the timetable. */
/**
 * One plain phrase about where the arrival time came from. Staff only need to
 * know whether to trust it: "live" (or nothing) vs "timetable, may be late".
 */
export function trackingNoteFor(t: RunTimingNotes): string | null {
  if (t.arrived) return 'Train has arrived'
  if (t.source === 'SCHEDULED') return 'Timetable time, live time not available'
  return t.checkedAt ? `Live time, updated ${formatTimeIST(t.checkedAt)}` : null
}
