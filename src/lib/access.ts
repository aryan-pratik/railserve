import type { Types } from 'mongoose'
import type { AuthContext } from './authContext'
import { Tenant } from './models/Tenant'
import { PermissionError, permissionsFor, type Permission, type RoleOverrides } from './permissions'

/**
 * Permission checks against the caller's tenant.
 *
 * A tenant's role overrides are read once and kept for a short while per
 * process: they change rarely (an admin editing Roles & access), and every
 * page would otherwise pay a Tenant read per check. The settings action
 * calls forgetTenantAccess() so its own change is visible at once.
 */
const TTL_MS = 30_000
const cache = new Map<string, { at: number; overrides: RoleOverrides }>()

async function overridesFor(tenantId: Types.ObjectId): Promise<RoleOverrides> {
  const key = String(tenantId)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.overrides
  const t = await Tenant.findById(tenantId).select('roleOverrides').lean()
  const overrides = ((t?.roleOverrides ?? {}) as RoleOverrides) || {}
  cache.set(key, { at: Date.now(), overrides })
  return overrides
}

export function forgetTenantAccess(tenantId: Types.ObjectId | string): void {
  cache.delete(String(tenantId))
}

/** Everything the caller may do. */
export async function permissionsOf(ctx: AuthContext): Promise<Set<Permission>> {
  return permissionsFor(ctx.role, await overridesFor(ctx.tenantId))
}

export async function can(ctx: AuthContext, permission: Permission): Promise<boolean> {
  return (await permissionsOf(ctx)).has(permission)
}

/** For server actions and repositories: throws PermissionError when not allowed. */
export async function assertCan(ctx: AuthContext, permission: Permission): Promise<void> {
  if (!(await can(ctx, permission))) throw new PermissionError(permission)
}
