import { Schema, model, models, type InferSchemaType, type Model } from 'mongoose'

/**
 * Singleton row tracking Gmail ingestion health.
 *
 * historyId is the resume point for history.list; without persisting it, a
 * restart either replays everything or silently skips messages. watchExpiresAt
 * exists because a Gmail watch dies after 7 days and takes ingestion with it,
 * with no error anywhere (plan §6, §13.4).
 */
const IngestStateSchema = new Schema(
  {
    _id: { type: String, required: true },
    historyId: { type: String, default: null },
    watchExpiresAt: { type: Date, default: null },
    lastWatchRenewalAt: { type: Date, default: null },
    lastMessageAt: { type: Date, default: null },
    lastError: { type: String, default: null },
  },
  { timestamps: true, strict: true, strictQuery: true, versionKey: false },
)

export type IngestStateDoc = InferSchemaType<typeof IngestStateSchema> & { _id: string }

export const IngestState: Model<IngestStateDoc> =
  (models.IngestState as Model<IngestStateDoc>) ??
  model<IngestStateDoc>('IngestState', IngestStateSchema)

export const GMAIL_STATE_ID = 'gmail'
