import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose'
import { registerModel } from './registerModel'

/**
 * One kitchen-printer job, queued for a station's local print agent to pick
 * up. The images are rendered eagerly at enqueue time (screenshot of the
 * real KotTicket, see printer/screenshot.ts) — the agent never talks to the
 * app's data layer, it only fetches bytes and hands them to the printer.
 */
const PrintJobSchema = new Schema(
  {
    // THE routing key: a job belongs to a kitchen, not to a brand. One
    // station is one printer is one agent, and a run job legitimately spans
    // every brand trading at that station.
    stationCode: { type: String, required: true, uppercase: true, trim: true },
    // Provenance only — never a claim filter. Set for refType 'order', null
    // for 'run' (which spans brands). Kept through the cutover so rolling
    // back to the previous image can still find its own jobs.
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', default: null },
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
  registerModel<PrintJobDoc>('PrintJob', PrintJobSchema)
