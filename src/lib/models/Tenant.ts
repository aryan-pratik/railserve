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
export const TENANT_STATUSES = ['ACTIVE', 'SUSPENDED', 'ARCHIVED'] as const
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
  },
  { timestamps: true, strict: true, strictQuery: true },
)

export type TenantDoc = InferSchemaType<typeof TenantSchema>

export const Tenant: Model<TenantDoc> = registerModel<TenantDoc>('Tenant', TenantSchema)

export { TenantSchema }
