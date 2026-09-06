import { Payment } from '../../models'
import { SlicePaymentParser } from './slice'
import type { ParsedPayment, PaymentParser } from './types'

export type { ParsedPayment, PaymentParseResult, PaymentParser } from './types'
export { SlicePaymentParser } from './slice'

/**
 * Tried before the order parsers, and before anything is filed as unparsed.
 *
 * A bank alert is not a failed order — routing it to the unparsed inbox made
 * a "food nobody is cooking" alarm ring for money arriving safely, which is
 * how an alarm gets ignored.
 */
export const PAYMENT_PARSERS: PaymentParser[] = [new SlicePaymentParser()]

export type PaymentRecordResult =
  | { status: 'CREATED'; paymentId: string; rrn: string }
  | { status: 'DUPLICATE'; rrn: string }

/**
 * Writes a parsed alert, idempotently.
 *
 * Gmail's history sync replays the same message routinely, and an admin
 * re-pasting an alert they already received is normal rather than
 * exceptional. Both must be a no-op success, never a second row and never an
 * error — a duplicated credit would inflate the day's takings.
 *
 * Idempotence is enforced twice, on purpose:
 *
 *  1. An upsert keyed on the RRN, which needs no index to be correct. A
 *     replay minutes or days later matches the existing row and writes
 *     nothing. This is what makes the ledger safe on a database where
 *     `npm run indexes` has not been run — and with autoIndex disabled, that
 *     is a real and silent state, not a hypothetical one.
 *  2. The unique index on `rrn`, which closes the one gap an upsert leaves:
 *     two writers racing on an RRN that does not exist yet can both insert.
 *     Where the index exists, the loser gets a duplicate-key error, caught
 *     below and reported as the no-op it is.
 *
 * `$setOnInsert` rather than `$set` throughout, so a replay never overwrites
 * a remark someone has since written against the payment.
 *
 * Callers pass `gmailMessageId: null` for a paste or a backfill — the field is
 * omitted entirely rather than stored as null, because the unique index on it
 * is partial on strings and a stored null would collide with the next one.
 */
export async function recordPayment(
  parsed: ParsedPayment,
  rawPayload: unknown,
  gmailMessageId: string | null,
  receivedAt: Date,
): Promise<PaymentRecordResult> {
  try {
    const res = await Payment.updateOne(
      { rrn: parsed.rrn },
      {
        // rrn is deliberately absent — Mongo takes it from the equality
        // filter on insert, and naming it here as well is a write conflict.
        $setOnInsert: {
          provider: parsed.provider,
          payerName: parsed.payerName,
          amountPaise: parsed.amountPaise,
          method: parsed.method,
          accountLast4: parsed.accountLast4,
          transactionDate: parsed.transactionDate,
          receivedAt,
          availableBalancePaise: parsed.availableBalancePaise,
          rawPayload,
          ...(gmailMessageId ? { gmailMessageId } : {}),
        },
      },
      { upsert: true },
    )

    return res.upsertedId
      ? { status: 'CREATED', paymentId: String(res.upsertedId), rrn: parsed.rrn }
      : { status: 'DUPLICATE', rrn: parsed.rrn }
  } catch (err) {
    if (typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000) {
      return { status: 'DUPLICATE', rrn: parsed.rrn }
    }
    throw err
  }
}
