import mongoose, { Schema, model, models, type InferSchemaType, type Model } from 'mongoose'

/**
 * One kitchen-printer job, queued for an outlet's local print agent to pick
 * up. The images are rendered eagerly at enqueue time (screenshot of the
 * real KotTicket, see printer/screenshot.ts) — the agent never talks to the
 * app's data layer, it only fetches bytes and hands them to the printer.
 */
const PrintJobSchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    refType: { type: String, enum: ['order', 'run'], required: true },
    refId: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'claimed', 'done', 'failed'],
      default: 'pending',
      index: true,
    },
    // One PNG per ticket/cut, in print order.
    images: { type: [Buffer], required: true },
    claimedAt: { type: Date, default: null },
    doneAt: { type: Date, default: null },
    error: { type: String, default: null },
  },
  { timestamps: true, strict: true, strictQuery: true },
)

export type PrintJobDoc = InferSchemaType<typeof PrintJobSchema> & { _id: mongoose.Types.ObjectId }

export const PrintJob: Model<PrintJobDoc> =
  (models.PrintJob as Model<PrintJobDoc>) ?? model<PrintJobDoc>('PrintJob', PrintJobSchema)
