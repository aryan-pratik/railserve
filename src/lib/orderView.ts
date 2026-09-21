import type { OrderCardData } from '@/components/OrderCard'
import { formatTimeIST } from './format'

type LeanCallNote = { text: string; createdAt: Date }

/**
 * The hover text for an order's passenger notes, built here on the server.
 *
 * A finished string rather than the notes themselves, for two reasons. The
 * tables that carry this are client components, and a Date crossing that
 * boundary is the silent-corruption case React warns about. And the hint is
 * rendered by the browser's own tooltip, which takes text and nothing else.
 *
 * Why the browser's tooltip and not a styled popover: every table showing this
 * sits inside TableFrame's `overflow-x-auto`, and CSS computes `visible` on
 * one axis to `auto` when the other is not visible — so an absolutely
 * positioned popover would be clipped by its own row, on the one screen where
 * being readable is the entire point. A title attribute is drawn by the
 * browser outside the document and cannot be clipped. The remark column on
 * these same tables already works this way.
 */
export type CallNoteSummary = { count: number; hint: string | null }

export function callNoteSummary(callLog: LeanCallNote[] | undefined | null): CallNoteSummary {
  const notes = callLog ?? []
  if (notes.length === 0) return { count: 0, hint: null }

  // Newest first: on a board being scanned, the latest thing the passenger
  // said is the one that changes what you do next.
  const recent = notes.slice(-3).reverse()
  const hidden = notes.length - recent.length

  const hint = [
    `${notes.length} call note${notes.length === 1 ? '' : 's'}`,
    ...recent.map((n) => `${formatTimeIST(n.createdAt)}: ${n.text}`),
    hidden > 0 ? `…and ${hidden} earlier` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n')

  return { count: notes.length, hint }
}

/**
 * The same thing, shaped for spreading into a table row.
 *
 * `?? []` is load bearing: findMany is .lean(), which skips the schema's
 * `default: []`, so callLog is undefined on every order written before the
 * field existed and InferSchemaType types it non-optional.
 */
export function callNoteRow(order: { callLog?: LeanCallNote[] | null }) {
  const { count, hint } = callNoteSummary(order.callLog ?? [])
  return { callNoteCount: count, callNoteHint: hint }
}

type LeanOrder = {
  _id: unknown
  externalOrderId: string
  orderType: string
  status: string
  trainNo?: string | null
  trainName?: string | null
  rawSeat?: string | null
  handoverPoint?: string | null
  pax?: number | null
  scheduledArrival?: Date | null
  readyBy?: Date | null
  serviceDate: string
  amountPaise?: number | null
  paymentMode?: string | null
  items: { _id: unknown; name: string; qty: number; spec?: string | null; notes?: string | null; isPacking: boolean }[]
  createdAt: Date
}

/**
 * Mongoose documents cross into client components here. Dates and ObjectIds
 * are not serialisable across that boundary, so they are flattened once, in one
 * place, rather than at each call site where one would eventually be missed.
 */
export function toCardData(o: LeanOrder): OrderCardData {
  return {
    id: String(o._id),
    externalOrderId: o.externalOrderId,
    orderType: o.orderType,
    status: o.status,
    trainNo: o.trainNo ?? null,
    trainName: o.trainName ?? null,
    rawSeat: o.rawSeat ?? null,
    handoverPoint: o.handoverPoint ?? null,
    pax: o.pax ?? null,
    scheduledArrival: o.scheduledArrival ? o.scheduledArrival.toISOString() : null,
    readyBy: o.readyBy ? o.readyBy.toISOString() : null,
    serviceDate: o.serviceDate,
    amountPaise: o.amountPaise ?? null,
    paymentMode: o.paymentMode ?? null,
    items: o.items.map((i) => ({
      id: String(i._id),
      name: i.name,
      qty: i.qty,
      spec: i.spec ?? null,
      notes: i.notes ?? null,
      isPacking: i.isPacking,
    })),
    createdAt: o.createdAt.toISOString(),
  }
}
