import type { OrderCardData } from '@/components/OrderCard'

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
  items: { _id: unknown; name: string; qty: number; spec?: string | null; isPacking: boolean }[]
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
      isPacking: i.isPacking,
    })),
    createdAt: o.createdAt.toISOString(),
  }
}
