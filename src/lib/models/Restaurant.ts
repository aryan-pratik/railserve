import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose'
import { registerModel } from './registerModel'

const RestaurantSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    stationCode: { type: String, required: true, uppercase: true, trim: true },
    stationName: { type: String, default: null, trim: true },
    // Outlet name variants seen in aggregator emails. Unused until Phase 2,
    // but the field is cheap and the parser depends on it existing.
    aliases: { type: [String], default: [] },
    contactName: { type: String, default: null, trim: true },
    contactPhone: { type: String, default: null, trim: true },
    walkToPlatformMinutes: { type: Number, default: 10, min: 0 },
    // Plan §2: never hard-delete. Deactivate, so orders never point at a gap.
    active: { type: Boolean, default: true },
    // LEGACY, read by nothing. The print agent belongs to a station now, not
    // to an aggregator brand — see models/Station.ts. Kept only so rolling
    // back to the pre-station image finds its token where it left it; the
    // values are purged once the new shape has proven itself in production.
    printAgentToken: { type: String, default: null },
  },
  { timestamps: true, strict: true, strictQuery: true },
)

export type RestaurantDoc = InferSchemaType<typeof RestaurantSchema> & { _id: mongoose.Types.ObjectId }

export const Restaurant: Model<RestaurantDoc> =
  registerModel<RestaurantDoc>('Restaurant', RestaurantSchema)

export { RestaurantSchema }
