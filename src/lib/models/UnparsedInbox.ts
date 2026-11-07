import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose'
import { registerModel } from './registerModel'

/**
 * Payloads that could not become an order. Plan §3 and §6.
 *
 * This is the safety net that stops a template change turning into silently
 * lost orders. Its volume is the signal that a parser has broken (§13.5).
 */
const UnparsedInboxSchema = new Schema(
  {
    source: { type: String, required: true },
    rawPayload: { type: Schema.Types.Mixed, required: true },
    reason: {
      type: String,
      required: true,
      enum: ['UNKNOWN_OUTLET', 'MISSING_FIELD', 'PARSE_FAILED'],
    },
    detail: { type: String, default: null },
    /** Whatever the parser did understand, so a human is not starting cold. */
    partial: { type: Schema.Types.Mixed, default: null },

    gmailMessageId: { type: String },
    externalOrderId: { type: String, default: null },

    resolved: { type: Boolean, default: false },
    resolvedAt: { type: Date, default: null },
    resolvedById: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    /** Set when resolving created an order, so the two can be tied together. */
    resolvedOrderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    /**
     * How the row was closed. Null on rows closed before this was recorded,
     * and on open rows. DISMISSED rows can be reopened; the others cannot,
     * because an order or a payment already exists for them.
     */
    resolution: { type: String, enum: ['ORDER', 'PAYMENT', 'DISMISSED', null], default: null },
    /**
     * Set when the row was closed by a bulk action: one id per click, so the
     * Resolved tab can say "1 of 120 dismissed together" and an undo can take
     * back exactly that batch and nothing else.
     */
    bulkActionId: { type: String, default: null },
    bulkActionCount: { type: Number, default: null },
  },
  { timestamps: true, strict: true, strictQuery: true },
)

export type UnparsedInboxDoc = InferSchemaType<typeof UnparsedInboxSchema> & {
  _id: mongoose.Types.ObjectId
}

export const UnparsedInbox: Model<UnparsedInboxDoc> =
  registerModel<UnparsedInboxDoc>('UnparsedInbox', UnparsedInboxSchema)

export { UnparsedInboxSchema }
