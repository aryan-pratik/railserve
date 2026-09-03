import mongoose, { Schema, model, models, type InferSchemaType, type Model } from 'mongoose'

/**
 * Cached live status for one train at one station on one day. Plan §3.
 *
 * Keyed so that ten orders on the same train cost one provider call (§8).
 * `fetchedAt` is what makes staleness visible: a value here is only as good as
 * its age, and the UI must never present a stale ETA as live.
 */
const TrainStatusSchema = new Schema(
  {
    trainNo: { type: String, required: true, trim: true },
    serviceDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    stationCode: { type: String, required: true, uppercase: true, trim: true },

    etaAt: { type: Date, default: null },
    delayMinutes: { type: Number, default: null },
    platform: { type: String, default: null },

    fetchedAt: { type: Date, required: true },
    // When the railway feed itself last had news, as opposed to when we last
    // asked (`fetchedAt`). A reading a second old can rest on a position forty
    // minutes old, and only this field can say so. Null when the provider does
    // not publish one, or before a run has started.
    providerUpdatedAt: { type: Date, default: null },

    // True once the provider confirms the train has actually left this
    // station, at which point its arrival/platform/delay here are final and
    // polling stops (see TrainStatusReading.arrived for why this is not
    // inferred from etaAt vs now). Never reset back to false — a later
    // failed or empty read must not un-arrive a train that genuinely came.
    arrived: { type: Boolean, default: false },

    // Set when the last fetch failed. The previous values are kept — degrading
    // to a known-old ETA beats showing nothing (§8) — but callers must be able
    // to tell the difference.
    lastError: { type: String, default: null },
    lastSuccessAt: { type: Date, default: null },
    provider: { type: String, default: null },
  },
  { timestamps: true, strict: true, strictQuery: true },
)

export type TrainStatusDoc = InferSchemaType<typeof TrainStatusSchema> & {
  _id: mongoose.Types.ObjectId
}

export const TrainStatus: Model<TrainStatusDoc> =
  (models.TrainStatus as Model<TrainStatusDoc>) ??
  model<TrainStatusDoc>('TrainStatus', TrainStatusSchema)

export { TrainStatusSchema }
