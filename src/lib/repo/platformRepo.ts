import bcrypt from 'bcryptjs'
import mongoose, { Types } from 'mongoose'
import { connectDb } from '../db'
import { ensureIndexes } from '../indexes'
import { Order, Restaurant, Tenant, User, type TenantStatus } from '../models'
import { todayIST } from '../format'
import { tenantGuardMode } from '../tenancy/plugin'

/**
 * Super-admin operations across tenants. Everything here is platform code:
 * the reads deliberately span every tenant (`allTenants`), and only
 * requirePlatformAdmin() callers reach it.
 */

export type TenantRow = {
  id: string
  name: string
  slug: string
  status: TenantStatus
  primary: boolean
  createdAt: Date | null
  outlets: number
  users: number
  orders30d: number
  lastOrderAt: Date | null
}

async function countByTenant(model: mongoose.Model<unknown>, match: Record<string, unknown>): Promise<Map<string, number>> {
  const rows = await model
    .aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: match }, { $group: { _id: '$tenantId', n: { $sum: 1 } } }])
    .option({ allTenants: true })
  return new Map(rows.map((r) => [String(r._id), r.n]))
}

export async function listTenants(): Promise<TenantRow[]> {
  await connectDb()
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000)
  const sinceDate = todayIST(since)
  const [tenants, outlets, users, orders, last] = await Promise.all([
    Tenant.find({}).sort({ primary: -1, createdAt: 1 }).lean(),
    countByTenant(Restaurant as unknown as mongoose.Model<unknown>, { active: true }),
    countByTenant(User as unknown as mongoose.Model<unknown>, { active: true }),
    countByTenant(Order as unknown as mongoose.Model<unknown>, { serviceDate: { $gte: sinceDate } }),
    Order.aggregate<{ _id: Types.ObjectId; at: Date }>([{ $group: { _id: '$tenantId', at: { $max: '$createdAt' } } }]).option({ allTenants: true }),
  ])
  const lastAt = new Map(last.map((r) => [String(r._id), r.at]))
  return tenants.map((t) => {
    const id = String(t._id)
    return {
      id,
      name: t.settings?.displayName || t.name,
      slug: t.slug,
      status: t.status as TenantStatus,
      primary: Boolean(t.primary),
      createdAt: t.createdAt ?? null,
      outlets: outlets.get(id) ?? 0,
      users: users.get(id) ?? 0,
      orders30d: orders.get(id) ?? 0,
      lastOrderAt: lastAt.get(id) ?? null,
    }
  })
}

export class PlatformInputError extends Error {}

export type NewTenantInput = {
  name: string
  slug: string
  adminName: string
  adminPhone: string
  adminPassword: string
  maxOutlets: number
  maxUsers: number
}

/**
 * Creates a customer company and its first administrator. The first time a
 * second tenant appears, the legacy global unique indexes are dropped in
 * favour of their per-tenant forms (see src/lib/indexes.ts), so two companies
 * can both issue MAN-YYYYMMDD-001.
 */
export async function createTenant(input: NewTenantInput): Promise<{ tenantId: string }> {
  // In log mode an unscoped query still runs across every tenant. That is
  // harmless while only the primary exists and a leak the moment a second
  // one does, so a second company needs the guard enforcing first.
  if (tenantGuardMode() !== 'throw') {
    throw new PlatformInputError('Set TENANT_GUARD=throw on this server before adding a company (see docs/TENANCY.md).')
  }
  await connectDb()
  const slug = input.slug.toLowerCase()
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) {
    throw new PlatformInputError('Handle: 3–40 lowercase letters, digits or dashes.')
  }
  if (await Tenant.exists({ slug })) throw new PlatformInputError('That handle is taken.')
  // Login is by phone across the whole platform, so a phone can belong to one person only.
  if (await User.exists({ phone: input.adminPhone }).setOptions({ allTenants: true })) {
    throw new PlatformInputError('That phone number already has an account on the platform.')
  }

  const passwordHash = await bcrypt.hash(input.adminPassword, 10)
  const session = await mongoose.startSession()
  let tenantId: Types.ObjectId | null = null
  try {
    await session.withTransaction(async () => {
      const [tenant] = await Tenant.create(
        [{ name: input.name, slug, status: 'ACTIVE', primary: false, plan: { code: 'STANDARD', maxOutlets: input.maxOutlets, maxUsers: input.maxUsers } }],
        { session },
      )
      tenantId = tenant._id
      await User.create(
        [{ tenantId: tenant._id, name: input.adminName, phone: input.adminPhone, passwordHash, role: 'ADMIN', restaurantIds: [], active: true }],
        { session },
      )
    })
  } finally {
    await session.endSession()
  }
  await ensureIndexes({ multiTenant: true })
  return { tenantId: String(tenantId) }
}

/** Suspending signs every one of the tenant's users out at their next request. */
export async function setTenantStatus(id: string, status: TenantStatus, reason: string | null): Promise<void> {
  await connectDb()
  const t = await Tenant.findById(id).select('primary status onboarding.appliedAt onboarding.approvedAt').lean()
  if (!t) throw new PlatformInputError('No such company.')
  // A declined application has no account left to switch back on.
  if (t.onboarding?.appliedAt && !t.onboarding.approvedAt) throw new PlatformInputError('This application was declined. They can apply again.')
  // A company still joining is let in by finishing its steps (repo/onboardingRepo), never by a status switch.
  if (t.status === 'ONBOARDING') throw new PlatformInputError('This company is still joining. Review it under Applications.')
  if (t.primary && status !== 'ACTIVE') throw new PlatformInputError('The primary company cannot be suspended.')
  await Tenant.updateOne(
    { _id: id },
    status === 'ACTIVE'
      ? { $set: { status, suspendedAt: null, suspendedReason: null } }
      : { $set: { status, suspendedAt: new Date(), suspendedReason: reason } },
  )
}
