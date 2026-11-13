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
  orderType: 'RETAIL' | 'BULK' | 'LOCAL'
  status: string
  /** What the rider has to do, in the server's words. Optional: older servers omit it. */
  riderStatus?: string
  riderStatusLabel?: string
  /** The booking's date, which is not always today's (see the Orders tab). */
  serviceDate?: string
  /**
   * false for a ready order nobody was given — open on the counter to any
   * rider at the outlet. Optional: a server older than the app omits it, and
   * then every order the rider sees is theirs.
   */
  assignedToMe?: boolean
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
  remark: string | null
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
  /** A run of local orders (no train). Optional: older servers omit it. */
  local?: boolean
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

export type Outcome = 'DELIVERED' | 'FAILED' | 'CANCELLED'

/** One finished job, as the rider's own record shows it. */
export type HistoryOrder = {
  id: string
  externalOrderId?: string
  serviceDate?: string
  status: Outcome
  trainNo: string | null
  trainName: string | null
  coach: string | null
  berth: string | null
  handoverPoint: string | null
  contactName: string | null
  /** Masked to first and last three digits once the order is 30 hours closed. */
  contactPhone: string | null
  phoneMasked?: boolean
  amountPaise: number | null
  paymentMode: string | null
  itemCount: number
  closedAt?: string | null
  deliveredAt: string | null
  receivedBy: string | null
  amountCollectedPaise: number | null
  failureReason: string | null
  /** Somebody authorised has received this order's cash, and who. */
  codSettledAt?: string | null
  codReceivedBy?: string | null
  /** Why it reads as cancelled when the office recorded something more specific. */
  statusDetail?: string | null
  riderStatusLabel?: string
  /** Until when the rider may still change how it ended; null once they can't. */
  editableUntil?: string | null
  /**
   * The bag has to go back to the outlet it left (cancelled or not delivered
   * after pickup). PENDING until the counter marks it returned.
   */
  rto?: { status: 'PENDING' | 'RETURNED'; returnTo: string | null; returnedAt: string | null } | null
}

export type HistoryQuery = { date?: string; q?: string }

/**
 * A period's figures as the server counted them, from the same ledger the
 * office's Riders page reads. The app shows these as sent and never adds the
 * rows up itself, so the two screens cannot disagree.
 */
export type RiderDay = {
  done: number
  delivered: number
  notDelivered: number
  cancelled: number
  codOrders: number
  codPaise: number
  prepaidOrders: number
  deliveredPaise: number
  amountPaise: number
}

/** One handover of cash, and who received it. */
export type Collection = {
  id: string
  at: string
  paise: number
  orders: number
  receivedBy: string | null
  receivedAs: string | null
}

export type TeamMember = {
  id: string
  name: string
  phone: string
  active: boolean
  isLead: boolean
  day: RiderDay
  now: { inHand: number; waiting: number; trains: string[]; inHandCodPaise: number }
  due: { paise: number; orders: number; orderIds: string[] }
  lastCollection: { at: string; paise: number; orders: number; receivedBy: string | null } | null
}

export type TeamResponse = {
  fetchedAt: string
  day: string
  lead: { id: string; name: string; phone: string; canReceiveCash: boolean }
  members: TeamMember[]
}

export type HistoryResponse = {
  fetchedAt: string
  view?: { kind: 'recent' | 'date' | 'search'; date?: string; q?: string }
  orders: HistoryOrder[]
  /** The period in view, counted by the server. Null for a search; absent on older servers. */
  summary?: RiderDay | null
  /** The reporting day in progress (3 am to 3 am), whatever period is in view. */
  today?: RiderDay & { day: string }
  /** Every handover, newest first. */
  collections?: Collection[]
  /** COD the rider is holding for the store, across every day not yet handed over. */
  wallet?: {
    pendingPaise: number
    pendingOrders: number
    lastSettlement: { at: string; paise: number; orders: number } | null
  }
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
  // Change how a finished order ended, within 30 hours. `from` is what the
  // rider saw, so a replay after the office changed it loses.
  | {
      kind: 'CORRECT_ORDER'
      clientId: string
      orderId: string
      from: Outcome
      to: Outcome
      reason?: string | null
      at: string
    }

/**
 * One position, as the phone hands it to the server. Not a QueuedMutation:
 * location is fire-and-forget and must never join the retry-forever queue —
 * see src/location.ts.
 */
export type LocationPing = {
  lat: number
  lng: number
  accuracyMetres: number | null
  speedMetresPerSecond: number | null
  headingDegrees: number | null
  recordedAt: string
}
