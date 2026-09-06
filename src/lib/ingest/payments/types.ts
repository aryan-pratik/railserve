/**
 * What a payment parser produces.
 *
 * Deliberately NOT a Payment document, for the same reason ParsedOrder is not
 * an Order: parsing and persisting are separate concerns, and a parser should
 * be testable without a database.
 */
export type ParsedPayment = {
  provider: string
  /** The "From" line — who paid. */
  payerName: string
  amountPaise: number
  /** The bank's reference number. The idempotency key. */
  rrn: string
  /** 'UPI', 'IMPS', 'NEFT' — whatever the alert said. */
  method: string | null
  accountLast4: string | null
  /** 'YYYY-MM-DD' in IST. */
  transactionDate: string
  availableBalancePaise: number | null
}

export type PaymentParseResult =
  | { ok: true; payment: ParsedPayment }
  | { ok: false; reason: 'PARSE_FAILED' | 'MISSING_FIELD'; detail: string; partial?: Partial<ParsedPayment> }

export interface PaymentParser {
  readonly provider: string

  /** Cheap check: is this a money-in alert we understand? */
  matches(body: string): boolean

  /**
   * @param body        raw email body
   * @param receivedAt  when the email arrived — the alert prints a two-digit
   *                    year and no time, so the century comes from here.
   */
  parse(body: string, receivedAt: Date): PaymentParseResult
}
