import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose'
import { registerModel } from './registerModel'
import { tenantScoped } from '../tenancy/plugin'

/**
 * A company's own Gmail, linked from the app (Settings → Order emails, or
 * onboarding): the mailbox its aggregator orders arrive in. One per company,
 * and one company per mailbox. The Google token is sealed (lib/crypto).
 *
 * Reading state (where sync resumes, the sender rules) stays in IngestState,
 * per company, exactly as for the mailbox set up on the server.
 */
const MailboxSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    tokenSealed: { type: String, required: true },
    linkedAt: { type: Date, required: true },
    linkedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    // Order emails found in the last 30 days when it was linked: zero is the
    // sign of the wrong Gmail.
    foundAtLink: { type: Number, default: null },
    watchExpiresAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    lastErrorAt: { type: Date, default: null },
  },
  { timestamps: true, strict: true, strictQuery: true },
)

MailboxSchema.index({ tenantId: 1 }, { unique: true })
MailboxSchema.index({ email: 1 }, { unique: true })

export type MailboxDoc = InferSchemaType<typeof MailboxSchema> & { _id: mongoose.Types.ObjectId }

MailboxSchema.plugin(tenantScoped)

export const Mailbox: Model<MailboxDoc> = registerModel<MailboxDoc>('Mailbox', MailboxSchema)
