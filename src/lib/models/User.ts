import mongoose, { Schema, model, models, type InferSchemaType, type Model } from 'mongoose'
import { ROLES } from '../roles'

const UserSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    // Phone is the login identifier — there is no email field anywhere in the plan.
    phone: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, required: true, enum: ROLES },
    // Set for STORE_MANAGER; null for ADMIN and DELIVERY_AGENT.
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', default: null },
    // Unwritten until Phase 3 (FCM). Kept so the mobile app needs no migration.
    fcmToken: { type: String, default: null },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, strict: true, strictQuery: true },
)

export type UserDoc = InferSchemaType<typeof UserSchema> & { _id: mongoose.Types.ObjectId }

export const User: Model<UserDoc> =
  (models.User as Model<UserDoc>) ?? model<UserDoc>('User', UserSchema)

export { UserSchema }
