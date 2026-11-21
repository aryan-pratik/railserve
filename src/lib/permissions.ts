import type { Role } from './roles'

/**
 * What a person may do inside their tenant.
 *
 * Roles stay the coarse shape of a job (who lands where, whose orders they
 * see). Permissions are the fine-grained switches behind every action, so a
 * tenant can, for example, let its telecallers create orders or stop its store
 * managers from collecting rider cash, without a code change.
 *
 * ROLE_PRESETS reproduces exactly what each role could do before permissions
 * existed. A tenant's own changes are stored as overrides on its Tenant
 * document (grant / revoke per role) and applied by permissionsFor().
 *
 * Outlet scope is not a permission: a store manager with `orders.view` still
 * sees only their own outlets' orders, because the repositories filter by
 * outlet. Permissions decide *what*, scope decides *which*.
 */
export const PERMISSIONS = {
  'orders.view': 'See orders',
  'orders.create': 'Enter orders by hand',
  'orders.edit': 'Edit order details and items',
  'orders.cancel': 'Cancel orders directly',
  'orders.requestCancel': 'Ask for an order to be cancelled',
  'orders.approveCancel': 'Approve or refuse cancellation requests',
  'orders.overrideStatus': 'Set any order status (admin override)',
  'kitchen.operate': 'Accept orders, print KOTs, mark ready',
  'delivery.assign': 'Assign riders and hand orders over',
  'delivery.operate': 'Deliver orders (rider app)',
  'returns.collect': 'Mark returned bags as back at the counter',
  'calls.operate': 'Use the call board and call notes',
  'chat.use': 'WhatsApp chat with passengers',
  'inbox.review': 'Review unparsed emails and pasted orders',
  'payments.view': 'See payments',
  'payments.reconcile': 'Link and annotate payments',
  'riders.manage': 'Add, edit and deactivate riders and teams',
  'riders.collectCash': "Collect riders' COD cash",
  'menu.manage': 'Tag and edit the menu',
  'analytics.view': 'See analytics and exports',
  'activity.view': 'See the activity log',
  'staff.manage': 'Add, edit and deactivate staff',
  'outlets.manage': 'Manage outlets, stations and routing',
  'company.manage': 'Edit company settings and integrations',
  'roles.manage': 'Change what each role may do',
} as const

export type Permission = keyof typeof PERMISSIONS

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[]

/** Grouping for the "Roles & access" settings screen. */
export const PERMISSION_GROUPS: { label: string; permissions: Permission[] }[] = [
  { label: 'Orders', permissions: ['orders.view', 'orders.create', 'orders.edit', 'orders.cancel', 'orders.requestCancel', 'orders.approveCancel', 'orders.overrideStatus'] },
  { label: 'Kitchen & delivery', permissions: ['kitchen.operate', 'delivery.assign', 'delivery.operate', 'returns.collect'] },
  { label: 'Customers', permissions: ['calls.operate', 'chat.use', 'inbox.review'] },
  { label: 'Money', permissions: ['payments.view', 'payments.reconcile', 'riders.collectCash'] },
  { label: 'Team & setup', permissions: ['riders.manage', 'menu.manage', 'staff.manage', 'outlets.manage', 'company.manage', 'roles.manage'] },
  { label: 'Insight', permissions: ['analytics.view', 'activity.view'] },
]

/** What each role could do before permissions existed. Behaviour-preserving. */
export const ROLE_PRESETS: Record<Role, readonly Permission[]> = {
  ADMIN: ALL_PERMISSIONS,
  STORE_MANAGER: [
    'orders.view',
    'orders.create',
    'orders.requestCancel',
    'kitchen.operate',
    'delivery.assign',
    'returns.collect',
    'payments.view',
    'riders.manage',
    'riders.collectCash',
  ],
  TELECALLER: ['orders.view', 'calls.operate', 'chat.use', 'returns.collect', 'payments.view'],
  DELIVERY_AGENT: ['delivery.operate'],
}

/**
 * The abilities a company can switch off (and back on) for a role today:
 * those whose v2 screen and server actions all check the permission. The
 * layers underneath still check roles, so an ability a role never had cannot
 * be granted yet, and the rest of the catalogue is shown but fixed.
 */
export const ADJUSTABLE: readonly Permission[] = [
  'orders.view',
  'orders.create',
  'kitchen.operate',
  'calls.operate',
  'chat.use',
  'payments.view',
  'riders.manage',
  'riders.collectCash',
]

/** True when a company may switch this ability for this role from Roles & access. */
export function isAdjustable(role: Role, permission: Permission): boolean {
  return EDITABLE_ROLES.includes(role) && ADJUSTABLE.includes(permission) && ROLE_PRESETS[role].includes(permission)
}

/** The roles a tenant may reshape. Admins keep everything; riders stay riders. */
export const EDITABLE_ROLES: Role[] = ['STORE_MANAGER', 'TELECALLER']

/**
 * Permissions an administrator can never lose, so a tenant cannot lock itself
 * out of its own settings by revoking them.
 */
export const ADMIN_LOCKED: readonly Permission[] = ['roles.manage', 'staff.manage', 'company.manage']

export type RoleOverrides = Partial<Record<Role, { grant?: string[]; revoke?: string[] }>>

function isPermission(p: string): p is Permission {
  return p in PERMISSIONS
}

/** The effective permission set for a role in a tenant. */
export function permissionsFor(role: Role, overrides?: RoleOverrides | null): Set<Permission> {
  const set = new Set<Permission>(ROLE_PRESETS[role])
  const o = overrides?.[role]
  for (const p of o?.grant ?? []) if (isPermission(p)) set.add(p)
  for (const p of o?.revoke ?? []) if (isPermission(p)) set.delete(p)
  // A rider app user stays a rider: office permissions never reach the
  // DELIVERY_AGENT role, and the rider permission never leaves it.
  if (role === 'DELIVERY_AGENT') return new Set<Permission>(['delivery.operate'])
  if (role === 'ADMIN') for (const p of ADMIN_LOCKED) set.add(p)
  // Changing who may do what stays with administrators.
  else set.delete('roles.manage')
  return set
}

export class PermissionError extends Error {
  constructor(public readonly permission: Permission) {
    super(`Not allowed: ${PERMISSIONS[permission]}`)
    this.name = 'PermissionError'
  }
}
