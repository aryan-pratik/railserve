import mongoose, { Schema, model, models, type InferSchemaType, type Model } from 'mongoose'
import { ORDER_STATUSES } from '../orderStatus'
import {
  ORDER_SOURCES,
  ORDER_TYPES,
  PAYMENT_MODES,
  PROOF_TYPES,
  TIMING_SOURCES,
} from '../orderEnums'

const OrderItemSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    qty: { type: Number, required: true, min: 1 },
    pricePaise: { type: Number, default: null, min: 0 },
    // Full composite menu text for bulk thalis. Plan §7: one item with
    // qty = pax and the whole menu here — do not shred a thali into 11 rows.
    spec: { type: String, default: null },
    // Tissue, spoon, water. Drives the PACKING section of the KOT.
    isPacking: { type: Boolean, default: false },
    notes: { type: String, default: null },
  },
  { _id: true },
)

const OrderEventSchema = new Schema(
  {
    fromStatus: { type: String, default: null, enum: [...ORDER_STATUSES, null] },
    toStatus: { type: String, required: true, enum: ORDER_STATUSES },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    meta: { type: Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, required: true, default: () => new Date() },
  },
  { _id: true },
)

const DeliverySchema = new Schema(
  {
    // Written null in the MVP; runs are derived from
    // (trainNo, serviceDate, stationCode) at query time. Materialised in
    // Phase 4 when dispatch automation needs a stable handle.
    runId: { type: String, default: null },
    // Array from day one: a 75-pax bulk handover is not a one-agent job (§9).
    agentIds: { type: [Schema.Types.ObjectId], ref: 'User', default: [] },
    assignedAt: { type: Date, default: null },
    dispatchedAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    proofType: { type: String, default: null, enum: [...PROOF_TYPES, null] },
    proofValue: { type: String, default: null },
    amountCollectedPaise: { type: Number, default: null, min: 0 },
    failureReason: { type: String, default: null },
  },
  { _id: false },
)

const OrderSchema = new Schema(
  {
    source: { type: String, required: true, enum: ORDER_SOURCES },
    orderType: { type: String, required: true, enum: ORDER_TYPES },
    externalOrderId: { type: String, required: true, trim: true },
    status: { type: String, required: true, enum: ORDER_STATUSES },

    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', default: null },
    stationCode: { type: String, required: true, uppercase: true, trim: true },

    trainNo: { type: String, default: null, trim: true },
    trainName: { type: String, default: null, trim: true },
    // 'YYYY-MM-DD' in IST. A string, not a Date: a date-only field stored as a
    // Date drifts across timezones and silently lands on the wrong day.
    serviceDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    scheduledArrival: { type: Date, default: null },
    // Always SCHEDULED in the MVP — there is no live train polling yet.
    timingSource: { type: String, required: true, enum: TIMING_SOURCES, default: 'SCHEDULED' },

    coach: { type: String, default: null, trim: true },
    berth: { type: String, default: null, trim: true },
    rawSeat: { type: String, default: null, trim: true },
    handoverPoint: { type: String, default: null },

    contactName: { type: String, default: null, trim: true },
    contactPhone: { type: String, default: null, trim: true },

    pax: { type: Number, default: null, min: 1 },
    // Money in paise, integer. No floats anywhere. (§2 conventions)
    amountPaise: { type: Number, default: null, min: 0 },
    paymentMode: { type: String, default: null, enum: [...PAYMENT_MODES, null] },

    readyBy: { type: Date, default: null },
    notes: { type: String, default: null },

    items: { type: [OrderItemSchema], default: [] },
    events: { type: [OrderEventSchema], default: [] },
    delivery: { type: DeliverySchema, default: () => ({}) },

    rawPayload: { type: Schema.Types.Mixed, default: null },

    // Deliberately NOT `default: null`. The unique index on this field is
    // partial (only string values), so manual orders must OMIT the key
    // entirely. A stored null would make the second manual order collide.
    gmailMessageId: { type: String },

    createdById: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, strict: true, strictQuery: true },
)

export type OrderDoc = InferSchemaType<typeof OrderSchema> & { _id: mongoose.Types.ObjectId }

export const Order: Model<OrderDoc> =
  (models.Order as Model<OrderDoc>) ?? model<OrderDoc>('Order', OrderSchema)

export { OrderSchema }
