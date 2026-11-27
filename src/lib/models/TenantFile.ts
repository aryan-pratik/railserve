import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose'
import { registerModel } from './registerModel'
import { tenantScoped } from '../tenancy/plugin'

/**
 * A document a company uploaded when applying (licence, GST, PAN, ID, bank
 * proof). Personal data: stored here rather than in a public bucket, served
 * only through an authenticated route to the company's own admin and to a
 * platform admin (repo/onboardingRepo). Small by rule (5 MB at most), so a
 * Mongo document holds it; it is in the nightly backups like everything else.
 */
const TenantFileSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    kind: { type: String, required: true },
    fileName: { type: String, required: true, trim: true, maxlength: 200 },
    mime: { type: String, required: true },
    size: { type: Number, required: true, min: 1 },
    data: { type: Buffer, required: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, strict: true, strictQuery: true },
)

TenantFileSchema.index({ tenantId: 1, kind: 1, createdAt: -1 })

export type TenantFileDoc = InferSchemaType<typeof TenantFileSchema> & { _id: mongoose.Types.ObjectId }

TenantFileSchema.plugin(tenantScoped)

export const TenantFile: Model<TenantFileDoc> = registerModel<TenantFileDoc>('TenantFile', TenantFileSchema)
