import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose'
import { registerModel } from './registerModel'
import { tenantScoped } from '../tenancy/plugin'

/**
 * Cash a staff member (a store manager or a team leader) passed on to the
 * owner. A rider's cash goes rider → staff (recorded on the orders, see
 * riderCashRepo) → owner (recorded here). What a staff member still holds is
 * everything they received from riders minus these.
 */
const CashHandInSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    /** Who handed the cash in. */
    fromUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /** Money in paise, integer. */
    amountPaise: { type: Number, required: true, min: 1 },
    /** The admin who recorded receiving it. */
    byUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    at: { type: Date, required: true },
    note: { type: String, default: null, trim: true, maxlength: 200 },
  },
  { timestamps: true, strict: true, strictQuery: true },
)

CashHandInSchema.index({ tenantId: 1, fromUserId: 1, at: -1 })

export type CashHandInDoc = InferSchemaType<typeof CashHandInSchema> & { _id: mongoose.Types.ObjectId }

CashHandInSchema.plugin(tenantScoped)

export const CashHandIn: Model<CashHandInDoc> = registerModel<CashHandInDoc>('CashHandIn', CashHandInSchema)
