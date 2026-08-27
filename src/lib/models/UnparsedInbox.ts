import mongoose, { Schema, model, models, type InferSchemaType, type Model } from 'mongoose'

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
  },
  { timestamps: true, strict: true, strictQuery: true },
)

export type UnparsedInboxDoc = InferSchemaType<typeof UnparsedInboxSchema> & {
  _id: mongoose.Types.ObjectId
}

export const UnparsedInbox: Model<UnparsedInboxDoc> =
  (models.UnparsedInbox as Model<UnparsedInboxDoc>) ??
  model<UnparsedInboxDoc>('UnparsedInbox', UnparsedInboxSchema)

export { UnparsedInboxSchema }
