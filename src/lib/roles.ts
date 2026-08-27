export const ROLES = ['ADMIN', 'STORE_MANAGER', 'DELIVERY_AGENT'] as const

export type Role = (typeof ROLES)[number]

/** Landing route per role, used after login and by the proxy redirect. */
export const ROLE_HOME: Record<Role, string> = {
  ADMIN: '/admin/orders',
  STORE_MANAGER: '/store',
  DELIVERY_AGENT: '/agent',
}

/** Route prefix each role owns. Used for coarse route gating. */
export const ROLE_PREFIX: Record<Role, string> = {
  ADMIN: '/admin',
  STORE_MANAGER: '/store',
  DELIVERY_AGENT: '/agent',
}
