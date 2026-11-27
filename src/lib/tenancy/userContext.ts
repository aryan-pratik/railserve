import mongoose, { Types } from 'mongoose'
import type { AuthContext } from '../authContext'
import { connectDb } from '../db'
import { Tenant, User } from '../models'
import type { Role } from '../roles'
import { env } from '../env'

function platformAdminPhones(): Set<string> {
  return new Set(env.PLATFORM_ADMIN_PHONES.split(',').map((p) => p.trim()).filter(Boolean))
}

export type LoadedUser = {
  id: string
  name: string
  role: Role
  restaurantIds: string[]
  /** Pages an admin switched off for this person (lib/pageAccess.ts). */
  hiddenPages: string[]
  tenantId: string
  tenantName: string
  /** One of our own super admins (PLATFORM_ADMIN_PHONES, on the primary tenant). */
  platformAdmin: boolean
  /** Their company is still joining: only the onboarding screen is theirs (lib/session). */
  onboarding: boolean
}

/**
 * The signed-in user as the database holds them now, with their tenant.
 *
 * Shared by the web session and the mobile bearer token. The lookup is by the
 * user's own id from a signed token, so it is the one place a User read may
 * run across tenants (`allTenants`): the tenant is not known until the user is.
 * A user whose tenant is suspended or archived gets no context at all, which
 * signs every one of that tenant's staff out at their next request.
 */
export async function loadUser(userId: string): Promise<LoadedUser | null> {
  if (!mongoose.isValidObjectId(userId)) return null
  await connectDb()
  const user = await User.findOne({ _id: userId, active: true })
    .setOptions({ allTenants: true })
    .select('name phone role restaurantIds tenantId hiddenPages')
    .lean()
  if (!user?.tenantId) return null

  const tenant = await Tenant.findById(user.tenantId).select('name status primary settings.displayName').lean()
  // A company still joining keeps its owner signed in, for the onboarding
  // screen only; session.ts keeps them out of everything else.
  const onboarding = tenant?.status === 'ONBOARDING' && user.role === 'ADMIN'
  if (!tenant || (tenant.status !== 'ACTIVE' && !onboarding)) return null

  return {
    id: String(user._id),
    name: user.name ?? '',
    role: user.role as Role,
    restaurantIds: (user.restaurantIds ?? []).map(String),
    hiddenPages: (user.hiddenPages ?? []).map(String),
    tenantId: String(user.tenantId),
    tenantName: tenant.settings?.displayName || tenant.name,
    platformAdmin: Boolean(tenant.primary) && platformAdminPhones().has(String(user.phone ?? '')),
    onboarding,
  }
}

export function contextOf(user: LoadedUser): AuthContext {
  return {
    tenantId: new Types.ObjectId(user.tenantId),
    userId: new Types.ObjectId(user.id),
    role: user.role,
    restaurantIds: user.restaurantIds.map((id) => new Types.ObjectId(id)),
  }
}

/**
 * Context for server-side work that acts as a tenant's administrator with no
 * signed-in person behind it: cron jobs, webhooks, the print renderer. The
 * userId is a fresh id that matches no user, so audit events read "system".
 */
export function systemContext(tenantId: Types.ObjectId | string): AuthContext {
  return {
    tenantId: new Types.ObjectId(String(tenantId)),
    userId: new Types.ObjectId(),
    role: 'ADMIN',
    restaurantIds: [],
  }
}
