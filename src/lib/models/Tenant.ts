import { Schema, type InferSchemaType, type Model } from 'mongoose'
import { registerModel } from './registerModel'

/**
 * One customer company on the platform. Platform-owned: it carries no
 * tenantId of its own and is not covered by the tenant guard.
 *
 * Our own operation is the primary tenant (`primary: true`). It owns the
 * integrations still configured by environment variables (the Gmail mailbox,
 * the MSG91 number), and it keeps legacy unprefixed keys for counters and the
 * menu so an older image can still run on migrated data after a rollback.
 */
// ONBOARDING: signed up on their own and not yet approved. Its admin can sign
// in, but sees only the onboarding screen (lib/session.ts) until documents
// are accepted, Gmail is linked and payment is received (lib/onboarding.ts).
export const TENANT_STATUSES = ['ACTIVE', 'ONBOARDING', 'SUSPENDED', 'ARCHIVED'] as const
export type TenantStatus = (typeof TENANT_STATUSES)[number]

const TenantSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    // URL-safe handle, unique on the platform. Used for the inbound mail
    // address and any future subdomain.
    slug: { type: String, required: true, trim: true, lowercase: true },
    status: { type: String, required: true, enum: TENANT_STATUSES, default: 'ACTIVE' },
    primary: { type: Boolean, default: false },
    plan: {
      code: { type: String, default: 'STANDARD' },
      maxOutlets: { type: Number, default: 10 },
      maxUsers: { type: Number, default: 100 },
    },
    // What the customer sees and prints.
    settings: {
      displayName: { type: String, default: null, trim: true },
      kotHeader: { type: String, default: null, trim: true },
      contactPhone: { type: String, default: null, trim: true },
      contactEmail: { type: String, default: null, trim: true },
    },
    // Per-role changes to the permission presets (src/lib/permissions.ts):
    // { STORE_MANAGER: { grant: [...], revoke: [...] }, ... }. Edited from
    // Settings → Roles & access.
    roleOverrides: { type: Schema.Types.Mixed, default: {} },
    suspendedAt: { type: Date, default: null },
    suspendedReason: { type: String, default: null },
    // A company that applied through /signup: its documents, payment and the
    // record of every decision. Null on companies created from /platform.
    onboarding: {
      type: new Schema(
        {
          appliedAt: { type: Date, required: true },
          ownerName: { type: String, default: null, trim: true },
          ownerEmail: { type: String, default: null, trim: true, lowercase: true },
          documents: {
            type: [
              new Schema(
                {
                  kind: { type: String, required: true },
                  status: { type: String, required: true, enum: ['MISSING', 'PENDING', 'ACCEPTED', 'REJECTED'], default: 'MISSING' },
                  fileId: { type: Schema.Types.ObjectId, ref: 'TenantFile', default: null },
                  fileName: { type: String, default: null },
                  uploadedAt: { type: Date, default: null },
                  reason: { type: String, default: null, trim: true, maxlength: 300 },
                  reviewedAt: { type: Date, default: null },
                  reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
                },
                { _id: false },
              ),
            ],
            default: [],
          },
          payment: {
            status: { type: String, enum: ['DUE', 'CLAIMED', 'PAID'], default: 'DUE' },
            amountPaise: { type: Number, default: null, min: 0 },
            reference: { type: String, default: null, trim: true, maxlength: 80 },
            claimedAt: { type: Date, default: null },
            paidAt: { type: Date, default: null },
            markedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
            note: { type: String, default: null, trim: true, maxlength: 200 },
          },
          // Messages owed to the applicant (decisions, access granted). Sent
          // by email once sending is set up; always shown on their screen.
          notices: {
            type: [
              new Schema(
                {
                  at: { type: Date, required: true },
                  // REVIEW notices gather every decision made in one sitting.
                  kind: { type: String, default: null },
                  subject: { type: String, required: true },
                  body: { type: String, required: true },
                  // Last change: a review message is rewritten while its
                  // sitting lasts, and emailed once it has been quiet.
                  updatedAt: { type: Date, default: null },
                  emailedAt: { type: Date, default: null },
                  emailError: { type: String, default: null },
                  attempts: { type: Number, default: 0 },
                },
                { _id: false },
              ),
            ],
            default: [],
          },
          approvedAt: { type: Date, default: null },
        },
        { _id: false },
      ),
      default: null,
    },
    // On the primary tenant only: what a new company pays, and how.
    // Edited on /platform, shown on every applicant's payment step.
    billing: {
      feePaise: { type: Number, default: null, min: 0 },
      upiId: { type: String, default: null, trim: true },
      bankDetails: { type: String, default: null, trim: true, maxlength: 500 },
    },
  },
  { timestamps: true, strict: true, strictQuery: true },
)

export type TenantDoc = InferSchemaType<typeof TenantSchema>

export const Tenant: Model<TenantDoc> = registerModel<TenantDoc>('Tenant', TenantSchema)

export { TenantSchema }
