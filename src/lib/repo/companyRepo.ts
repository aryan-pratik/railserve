import type { AuthContext } from '../authContext'
import { connectDb } from '../db'
import { Order, Restaurant, Tenant, User } from '../models'
import { permissionsFor, EDITABLE_ROLES, type Permission, type RoleOverrides } from '../permissions'
import { ROLES, type Role } from '../roles'
import { todayIST } from '../format'

/** The caller's company, its plan and how much of it is in use. */
export async function loadCompany(ctx: AuthContext) {
  await connectDb()
  const tenant = await Tenant.findById(ctx.tenantId).lean()
  if (!tenant) throw new Error('Tenant not found for this session')
  const monthStart = `${todayIST().slice(0, 7)}-01`
  const [outlets, users, ordersThisMonth] = await Promise.all([
    Restaurant.countDocuments({ tenantId: ctx.tenantId, active: true }),
    User.countDocuments({ tenantId: ctx.tenantId, active: true }),
    Order.countDocuments({ tenantId: ctx.tenantId, serviceDate: { $gte: monthStart } }),
  ])
  return {
    id: String(tenant._id),
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status,
    primary: Boolean(tenant.primary),
    settings: {
      displayName: tenant.settings?.displayName ?? '',
      kotHeader: tenant.settings?.kotHeader ?? '',
      contactPhone: tenant.settings?.contactPhone ?? '',
      contactEmail: tenant.settings?.contactEmail ?? '',
    },
    plan: {
      code: tenant.plan?.code ?? 'STANDARD',
      maxOutlets: tenant.plan?.maxOutlets ?? 10,
      maxUsers: tenant.plan?.maxUsers ?? 100,
    },
    usage: { outlets, users, ordersThisMonth },
    since: tenant.createdAt ?? null,
  }
}

/** What every role in the caller's company may do now. */
export async function loadRoleAccess(ctx: AuthContext) {
  await connectDb()
  const tenant = await Tenant.findById(ctx.tenantId).select('roleOverrides').lean()
  const overrides = (tenant?.roleOverrides ?? {}) as RoleOverrides
  const granted = Object.fromEntries(ROLES.map((r) => [r, [...permissionsFor(r, overrides)]])) as Record<Role, Permission[]>
  return { granted, editableRoles: EDITABLE_ROLES }
}
