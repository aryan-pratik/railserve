import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose'
import { registerModel } from './registerModel'
import { ROLES } from '../roles'

const UserSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    // Phone is the login identifier — there is no email field anywhere in the plan.
    phone: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, required: true, enum: ROLES },
    // Non-empty for STORE_MANAGER; empty for ADMIN and DELIVERY_AGENT.
    // An array because one manager commonly runs several outlets at the same
    // station — they need all of them on one board, not an outlet switcher.
    restaurantIds: { type: [Schema.Types.ObjectId], ref: 'Restaurant', default: [] },
    // Unwritten until Phase 3 (FCM). Kept so the mobile app needs no migration.
    fcmToken: { type: String, default: null },
    active: { type: Boolean, default: true },
    // A store manager an admin has allowed to take returned bags back at the
    // counter and mark the order returned (see lib/rto.ts). Per person, not
    // per role: one manager at an outlet owns that counter, the others need
    // not. Meaningless on any other role; an admin always may.
    canCollectReturns: { type: Boolean, default: false },
    // A rider who leads a team of riders. A team leader is still a rider:
    // they sign in to the same app and carry orders, and additionally see the
    // record of every rider placed under them. Kept as a mark on the rider
    // rather than a fifth role so nothing that asks "is this a rider" has to
    // learn a second answer. Meaningless on any other role.
    isTeamLead: { type: Boolean, default: false },
    // The team leader a rider reports to, set by an admin. Null: no team.
    teamLeadId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    // Whether this person may mark a rider's cash as received, set by an
    // admin (see lib/collections.ts). Null means nobody has decided: a store
    // manager then may, as every manager could before this existed, and a
    // team leader may not. An admin always may.
    canReceiveCash: { type: Boolean, default: null },
  },
  { timestamps: true, strict: true, strictQuery: true },
)

export type UserDoc = InferSchemaType<typeof UserSchema> & { _id: mongoose.Types.ObjectId }

export const User: Model<UserDoc> =
  registerModel<UserDoc>('User', UserSchema)

export { UserSchema }
