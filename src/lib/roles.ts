export const ROLES = ['ADMIN', 'STORE_MANAGER', 'DELIVERY_AGENT', 'TELECALLER'] as const

export type Role = (typeof ROLES)[number]

/** Human labels. Defined once — three separate copies had already drifted apart. */
export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Admin',
  STORE_MANAGER: 'Store manager',
  DELIVERY_AGENT: 'Rider',
  TELECALLER: 'Telecaller',
}

/**
 * Landing route per role, used after login and by the proxy redirect. The
 * dashboards live in v2 now; the rider app is still the v1 /agent screens.
 */
export const ROLE_HOME: Record<Role, string> = {
  ADMIN: '/v2/admin',
  STORE_MANAGER: '/v2/kitchen',
  DELIVERY_AGENT: '/agent',
  TELECALLER: '/v2/calls',
}

/**
 * Old v1 dashboard sections. A signed-in user who opens one (a bookmark, a
 * stale tab) is sent to their v2 home instead, so nobody keeps working in the
 * old UI by accident. Two kinds of v1 URL stay live because v2 still uses them:
 * the CSV export route handlers and the KOT print pages.
 */
export function isRetiredV1Page(pathname: string): boolean {
  if (!['/admin', '/store', '/calls'].some((r) => pathname === r || pathname.startsWith(`${r}/`))) return false
  if (pathname.endsWith('/export')) return false
  if (pathname.endsWith('/kot')) return false
  return true
}

/** Route prefix each role owns. Used for coarse route gating. */
export const ROLE_PREFIX: Record<Role, string> = {
  ADMIN: '/admin',
  STORE_MANAGER: '/store',
  DELIVERY_AGENT: '/agent',
  TELECALLER: '/calls',
}
