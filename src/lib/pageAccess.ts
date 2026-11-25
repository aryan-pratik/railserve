import type { Role } from './roles'

/*
 * Pages an admin can switch off for one staff member. Kitchen (a store
 * manager's home) and Calls to make (a telecaller's) are always on: they are
 * the job. A switched-off page is gone from that person's sidebar and its
 * address sends them home (requirePage in lib/session.ts). Admins are never
 * restricted: they set this.
 */
export const PAGES = [
  { key: 'returns', label: 'Returns', roles: ['STORE_MANAGER', 'TELECALLER'] },
  { key: 'riders', label: 'Riders and cash', roles: ['STORE_MANAGER'] },
  { key: 'payments', label: 'Payments', roles: ['STORE_MANAGER', 'TELECALLER'] },
  { key: 'orders', label: 'Orders', roles: ['TELECALLER'] },
  { key: 'chat', label: 'WhatsApp', roles: ['TELECALLER'] },
] as const satisfies readonly { key: string; label: string; roles: readonly Role[] }[]

export type PageKey = (typeof PAGES)[number]['key']

/** The pages an admin may switch off for someone in this role. */
export function pagesFor(role: Role): { key: PageKey; label: string }[] {
  return PAGES.filter((p) => (p.roles as readonly Role[]).includes(role)).map(({ key, label }) => ({ key, label }))
}

/** Which switchable page a sidebar link opens, if any. */
export function pageKeyOf(href: string): PageKey | null {
  if (href.startsWith('/v2/orders?view=returns')) return 'returns'
  if (href.startsWith('/v2/orders?view=enquiries')) return null
  if (href.startsWith('/v2/orders')) return 'orders'
  if (href.startsWith('/v2/riders')) return 'riders'
  if (href.startsWith('/v2/payments')) return 'payments'
  if (href.startsWith('/v2/chat')) return 'chat'
  return null
}

/** Only keys that exist, for this role. */
export function cleanHiddenPages(role: Role, keys: readonly string[]): PageKey[] {
  const allowed = new Set<string>(pagesFor(role).map((p) => p.key))
  return [...new Set(keys)].filter((k): k is PageKey => allowed.has(k))
}
