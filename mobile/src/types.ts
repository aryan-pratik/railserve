export type OrderItem = {
  id: string
  name: string
  qty: number
  isPacking: boolean
  spec: string | null
}

export type RunOrder = {
  id: string
  externalOrderId: string
  orderType: 'RETAIL' | 'BULK'
  status: string
  outletName: string | null
  coach: string | null
  berth: string | null
  rawSeat: string | null
  handoverPoint: string | null
  pax: number | null
  contactName: string | null
  contactPhone: string | null
  amountPaise: number | null
  paymentMode: string | null
  items: OrderItem[]
  delivery: {
    deliveredAt: string | null
    proofValue: string | null
    amountCollectedPaise: number | null
    failureReason: string | null
  }
}

export type Timing = {
  effectiveArrival: string | null
  source: 'LIVE' | 'SCHEDULED'
  delayMinutes: number | null
  platform: string | null
  ageMinutes: number | null
  stale: boolean
}

export type Run = {
  key: string
  trainNo: string | null
  trainName: string | null
  stationCode: string
  serviceDate: string
  statusCounts: Record<string, number>
  timing: Timing
  dispatchAt: string | null
  orders: RunOrder[]
}

export type RunsResponse = {
  serviceDate: string
  fetchedAt: string
  runs: Run[]
}

/** One finished job, as the rider's own record shows it. */
export type HistoryOrder = {
  id: string
  status: 'DELIVERED' | 'FAILED'
  trainNo: string | null
  trainName: string | null
  coach: string | null
  berth: string | null
  handoverPoint: string | null
  contactName: string | null
  contactPhone: string | null
  amountPaise: number | null
  paymentMode: string | null
  itemCount: number
  deliveredAt: string | null
  receivedBy: string | null
  amountCollectedPaise: number | null
  failureReason: string | null
}

export type HistoryResponse = {
  fetchedAt: string
  orders: HistoryOrder[]
}

export type QueuedMutation =
  | { kind: 'DISPATCH_RUN'; clientId: string; runKey: string; at: string }
  // One order rather than a whole train: a rider takes what they can carry.
  | { kind: 'DISPATCH_ORDER'; clientId: string; orderId: string; at: string }
  // Undo a mistapped pickup. Audited server-side like any status change.
  | { kind: 'RETURN_ORDER'; clientId: string; orderId: string; at: string }
  | {
      kind: 'DELIVER_ORDER'
      clientId: string
      orderId: string
      receivedBy: string
      /**
       * Object key of an already-uploaded photo. The image is pushed to the
       * bucket before the mutation is queued, so what waits in the offline
       * queue is a short string rather than megabytes of JPEG — the queue
       * survives in AsyncStorage and must stay small.
       */
      amountCollected?: string | null
      at: string
    }
  | { kind: 'FAIL_ORDER'; clientId: string; orderId: string; failureReason: string; at: string }
