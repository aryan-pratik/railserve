import mongoose, { Schema, model, models, type InferSchemaType, type Model } from 'mongoose'

/**
 * A money-in alert from the bank, turned into a row.
 *
 * These arrive in the same mailbox as the order emails and used to pile up in
 * the unparsed inbox — an alert channel that means "an order is not being
 * cooked" was reporting money landing safely, which is the fastest way to
 * teach someone to ignore it. They are their own thing, so they get their own
 * collection and their own page.
 *
 * Deliberately NOT tied to an Order. A UPI credit carries a payer name and a
 * reference number, nothing that identifies which order it settles, and
 * guessing would put a wrong number on a reconciliation. Matching stays a
 * human's job, which is what `remark` is for.
 */
const PaymentSchema = new Schema(
  {
    /** Which bank/app sent the alert. One value today; the parser registry takes more. */
    provider: { type: String, required: true, trim: true, default: 'SLICE' },

    /** The "From" line — who paid. */
    payerName: { type: String, required: true, trim: true },
    /** Money in paise, integer. No floats anywhere. (§2 conventions) */
    amountPaise: { type: Number, required: true, min: 0 },
    /**
     * The bank's Retrieval Reference Number. Unique, and the reason ingestion
     * is idempotent: the same alert replayed by a history sync, re-pasted by
     * hand, or backfilled from the inbox must not become a second row.
     */
    rrn: { type: String, required: true, trim: true },
    /** 'UPI', 'IMPS', 'NEFT' — whatever the alert said. */
    method: { type: String, default: null, trim: true },
    /** Which account it landed in, e.g. '8773'. One account today. */
    accountLast4: { type: String, default: null, trim: true },

    /**
     * 'YYYY-MM-DD' in IST, as printed on the alert. A string, not a Date, for
     * the same reason serviceDate is: a date-only value stored as a Date
     * lands on the previous day for anyone east of UTC. This is what the
     * date filter and the CSV both work in.
     */
    transactionDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    /** When the email itself arrived — the alert carries a date but no time. */
    receivedAt: { type: Date, required: true },

    /**
     * Balance after this credit, as quoted in the alert. Admin-only on screen:
     * a store manager needs to confirm a customer's payment arrived, not to
     * read the business's bank balance.
     */
    availableBalancePaise: { type: Number, default: null, min: 0 },

    /** Free text, editable by admin and store manager. Who paid for what. */
    remark: { type: String, default: null, trim: true },
    remarkById: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    remarkAt: { type: Date, default: null },

    /** The full alert as it arrived, before parsing. The record in a dispute. */
    rawPayload: { type: Schema.Types.Mixed, default: null },

    // Deliberately NOT `default: null` — the unique index is partial on
    // strings, so a pasted or backfilled payment omits the key entirely
    // rather than storing a null that would collide with the next one.
    gmailMessageId: { type: String },
  },
  { timestamps: true, strict: true, strictQuery: true },
)

export type PaymentDoc = InferSchemaType<typeof PaymentSchema> & {
  _id: mongoose.Types.ObjectId
}

export const Payment: Model<PaymentDoc> =
  (models.Payment as Model<PaymentDoc>) ?? model<PaymentDoc>('Payment', PaymentSchema)

export { PaymentSchema }
