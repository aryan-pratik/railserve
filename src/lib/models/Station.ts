import { Schema, type InferSchemaType, type Model } from 'mongoose'
import { registerModel } from './registerModel'

/**
 * A station we operate at. One station is one physical kitchen, one thermal
 * printer, one print agent — however many aggregator brands take orders
 * there. Three brands at Kanpur Central are three sets of paperwork and one
 * stove, so the printer belongs to the place, not to the brand: that is why
 * `printAgentToken` lives here and no longer on Restaurant.
 *
 * The station code is the identity rather than a surrogate ObjectId. Every
 * order, outlet, run key and train-status row already joins on that string
 * (`Order.stationCode`, `Restaurant.stationCode`, the third segment of a
 * runKey — see runs.ts), so making it the `_id` means none of those have to
 * change. Same natural-key shape as Counter and IngestState.
 */
const StationSchema = new Schema(
  {
    _id: { type: String, required: true, uppercase: true, trim: true },
    // Authoritative display name. Outlets carry their own `stationName` and
    // disagree about it; admin/setup/OutletMultiSelect.tsx resolves that
    // today by taking whichever outlet it happened to read first.
    name: { type: String, default: null, trim: true },
    // Bearer token for this station's print agent. Partial-unique index in
    // scripts/indexes.ts — partial rather than sparse, because a station
    // with no agent yet stores an explicit null and sparse-unique still
    // collides on repeated nulls.
    printAgentToken: { type: String, default: null },
    // The agent polls every few seconds forever, so this is a heartbeat that
    // costs nothing extra to collect — and it is the difference between "the
    // printer is quiet" and "nothing has called in since 04:10".
    agentLastSeenAt: { type: Date, default: null },
    agentLastPrintedAt: { type: Date, default: null },
    // Deactivating a station revokes its agent without rotating the token.
    active: { type: Boolean, default: true },
  },
  { timestamps: true, strict: true, strictQuery: true, versionKey: false },
)

export type StationDoc = InferSchemaType<typeof StationSchema>

export const Station: Model<StationDoc> =
  registerModel<StationDoc>('Station', StationSchema)

export { StationSchema }
