import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose'
import { registerModel } from './registerModel'

/**
 * One point on a rider's recent path. Stripped to the two numbers and a time:
 * the trail is drawn, never inspected, and sixty of these ride along with
 * every read of the board.
 */
const TrailPointSchema = new Schema(
  {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    at: { type: Date, required: true },
  },
  { _id: false },
)

/**
 * Where a rider is, one document per rider.
 *
 * A log of every fix was the obvious shape and is the wrong one. The question
 * this collection exists to answer is "where is each rider right now", which a
 * log makes expensive — a sort-and-group across a day of pings per rider on
 * every board refresh, ten seconds apart, forever. One row per rider makes it
 * an indexed lookup of a few dozen documents, and the recent path lives in a
 * capped array on the same row, so the board is one query with no fan-out.
 *
 * The cost is that history beyond `trail` is not kept. That is deliberate:
 * nobody asked to replay a shift, and continuous location on a named worker is
 * not data to accumulate without a reason to. What is here is what a live board
 * needs and no more.
 *
 * There is no TTL. A TTL index would delete the rider's row rather than the
 * stale part of it, so a rider who finished their shift would vanish from the
 * board instead of reading "offline, last seen 7pm" — which is the answer the
 * admin actually wants. Staleness is read off `recordedAt` at render time
 * (see `presenceOf`), and the row is simply overwritten on the next shift.
 */
const RiderLocationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },

    // The most recent accepted fix. Denormalised out of `trail` rather than
    // read from its tail so the board never has to touch the array to answer
    // "where are they now".
    lat: { type: Number, required: true, min: -90, max: 90 },
    lng: { type: Number, required: true, min: -180, max: 180 },

    // Radius the device claims the fix is good to. A platform is ~10m wide, so
    // a 500m fix is a tower triangulation and must not be drawn as a position.
    accuracyMetres: { type: Number, default: null, min: 0 },
    speedMetresPerSecond: { type: Number, default: null, min: 0 },
    headingDegrees: { type: Number, default: null, min: 0, max: 360 },

    // Device clock, clamped for skew — when the rider was there.
    recordedAt: { type: Date, required: true },
    // Server clock — when we found out. The gap between the two is how long
    // the phone was without signal, which is worth being able to see.
    receivedAt: { type: Date, required: true },

    trail: { type: [TrailPointSchema], default: [] },
  },
  { timestamps: true, strict: true, strictQuery: true },
)

export type RiderLocationDoc = InferSchemaType<typeof RiderLocationSchema> & {
  _id: mongoose.Types.ObjectId
}

export const RiderLocation: Model<RiderLocationDoc> =
  registerModel<RiderLocationDoc>('RiderLocation', RiderLocationSchema)

export { RiderLocationSchema }
