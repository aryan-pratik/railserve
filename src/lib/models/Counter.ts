import { Schema, model, models, type InferSchemaType, type Model } from 'mongoose'

/**
 * Sequence source for human-readable manual order IDs (MAN-20260827-001).
 *
 * Not in the plan's schema. Added because manual orders have no aggregator
 * order ID, but `externalOrderId` carries a unique index and must be populated.
 * A readable running number beats a random suffix here: store managers and
 * delivery agents read these IDs aloud over the phone from a noisy platform.
 */
const CounterSchema = new Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { strict: true, strictQuery: true, versionKey: false },
)

export type CounterDoc = InferSchemaType<typeof CounterSchema>

export const Counter: Model<CounterDoc> =
  (models.Counter as Model<CounterDoc>) ?? model<CounterDoc>('Counter', CounterSchema)

export { CounterSchema }
