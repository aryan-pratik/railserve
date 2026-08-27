import type { OrderSource, PaymentMode } from '../orderEnums'

/**
 * What a parser produces. Deliberately NOT an Order document: parsing and
 * persisting are separate concerns, and an outlet name still has to be resolved
 * to a restaurant before anything can be written.
 */
export type ParsedOrder = {
  source: OrderSource
  externalOrderId: string
  outletName: string
  stationName: string | null
  stationCode: string
  contactName: string | null
  contactPhone: string | null
  trainNo: string | null
  trainName: string | null
  coach: string | null
  berth: string | null
  rawSeat: string | null
  scheduledArrival: Date | null
  items: { name: string; qty: number; notes: string | null }[]
  amountPaise: number | null
  paymentMode: PaymentMode | null
}

/** Why a payload could not become an order. Plan §3 unparsedinbox reasons. */
export type ParseFailureReason = 'PARSE_FAILED' | 'MISSING_FIELD' | 'UNKNOWN_OUTLET'

export type ParseResult =
  | { ok: true; order: ParsedOrder }
  | { ok: false; reason: ParseFailureReason; detail: string; partial?: Partial<ParsedOrder> }

export interface OrderParser {
  readonly source: OrderSource

  /** Cheap check: does this payload look like ours? */
  matches(body: string): boolean

  /**
   * @param body        raw email body
   * @param receivedAt  when the email arrived — needed for year inference,
   *                    since aggregator dates carry no year.
   */
  parse(body: string, receivedAt: Date): ParseResult
}
