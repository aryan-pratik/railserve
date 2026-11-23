import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose'
import { registerModel } from './registerModel'
import { tenantScoped } from '../tenancy/plugin'
import { ORDER_SOURCES } from '../orderEnums'

/**
 * Where a company's orders come from by email: one row per source, holding
 * the addresses allowed to send it.
 *
 *   BUILTIN  one of the hand-written aggregator readers (key = its source,
 *            "ZOOP"); a row exists once an admin lists a sender for it.
 *   PAYMENT  a bank's credit alerts (key = "PAY:" + provider, "PAY:SLICE").
 *   TAUGHT   a layout an admin taught by highlighting one email (key =
 *            "T:" + id), with its rules. Always tied to its senders: a taught
 *            layout never reads mail from anyone else.
 *
 * With "only known senders" on (IngestState.enforceSenders), mail that looks
 * like Zoop's but did not come from one of Zoop's addresses is never turned
 * into an order; it waits in "Emails to check" instead. See lib/ingest.
 */
const MailSourceSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    key: { type: String, required: true },
    kind: { type: String, required: true, enum: ['BUILTIN', 'PAYMENT', 'TAUGHT'] },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    /** The aggregator its orders are filed under. Null for bank alerts. */
    source: { type: String, enum: [...ORDER_SOURCES, null], default: null },
    /** Addresses ("orders@zoop.in") or whole domains ("@zoop.in"). */
    senders: { type: [String], default: [] },
    /** Only trust mail Gmail confirmed really came from the sender's domain. */
    requireVerified: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    /** TAUGHT only: the rules (lib/ingest/templates/types.ts). */
    rules: { type: Schema.Types.Mixed, default: null },
    /** TAUGHT only: the email it was taught from, so it can be edited later. */
    sampleBody: { type: String, default: null },
    sampleReceivedAt: { type: Date, default: null },
    updatedById: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, strict: true, strictQuery: true },
)

export type MailSourceDoc = InferSchemaType<typeof MailSourceSchema> & { _id: mongoose.Types.ObjectId }

MailSourceSchema.plugin(tenantScoped)

export const MailSource: Model<MailSourceDoc> = registerModel<MailSourceDoc>('MailSource', MailSourceSchema)
