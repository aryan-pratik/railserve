import type { Role } from '@/lib/roles'
import type { V2NavSection } from '@/components/v2/SidebarNav'
import type { Permission } from '@/lib/permissions'

/** Where each role lands in v2. */
export const V2_HOME: Record<Role, string> = {
  ADMIN: '/v2/admin',
  STORE_MANAGER: '/v2/kitchen',
  TELECALLER: '/v2/calls',
  DELIVERY_AGENT: '/agent',
}

export type NavCounts = {
  live?: number
  unread?: number
  unparsed?: number
  returns?: number
  menuToCheck?: number
}

/**
 * One nav per role. Hrefs point at v2 routes; a route that is not built yet
 * falls back to its v1 page in `FALLBACK` below, so the sidebar never 404s.
 */
export function navFor(role: Role, c: NavCounts): V2NavSection[] {
  switch (role) {
    case 'ADMIN':
      return [
        {
          label: 'Operations',
          items: [
            { href: '/v2/admin', label: 'Today', icon: 'today', count: c.live },
            { href: '/v2/orders', label: 'Orders', icon: 'orders' },
            { href: '/v2/riders', label: 'Riders and cash', icon: 'riders' },
            { href: '/v2/chat', label: 'WhatsApp', icon: 'chat', count: c.unread },
          ],
        },
        {
          label: 'Check and manage',
          items: [
            { href: '/v2/inbox', label: 'Emails to check', icon: 'inbox', count: c.unparsed, alert: true },
            { href: '/v2/orders?view=enquiries', label: 'Group bookings', icon: 'enquiries' },
            { href: '/v2/orders?view=returns', label: 'Bags coming back', icon: 'returns', count: c.returns },
            { href: '/v2/payments', label: 'Payments', icon: 'payments' },
            { href: '/v2/menu', label: 'Menu', icon: 'menu', count: c.menuToCheck },
            { href: '/v2/analytics', label: 'Reports', icon: 'analytics' },
            { href: '/v2/activity', label: 'History', icon: 'activity' },
          ],
        },
        { label: 'Setup', items: [{ href: '/v2/settings', label: 'Settings', icon: 'settings' }] },
      ]
    case 'STORE_MANAGER':
      return [
        {
          label: 'Kitchen',
          items: [
            { href: '/v2/kitchen', label: 'Kitchen', icon: 'kitchen', count: c.live },
            { href: '/v2/orders', label: 'Orders', icon: 'orders' },
            { href: '/v2/orders?view=returns', label: 'Bags coming back', icon: 'returns', count: c.returns },
            { href: '/v2/riders', label: 'Riders and cash', icon: 'riders' },
            { href: '/v2/payments', label: 'Payments', icon: 'payments' },
          ],
        },
      ]
    case 'TELECALLER':
      return [
        {
          label: 'Call desk',
          items: [
            { href: '/v2/calls', label: 'Calls to make', icon: 'calls', count: c.live },
            { href: '/v2/orders', label: 'Orders', icon: 'orders' },
            { href: '/v2/chat', label: 'WhatsApp', icon: 'chat', count: c.unread },
            { href: '/v2/orders?view=returns', label: 'Bags coming back', icon: 'returns', count: c.returns },
            { href: '/v2/payments', label: 'Payments', icon: 'payments' },
          ],
        },
      ]
    case 'DELIVERY_AGENT':
      return [{ label: 'Rider', items: [{ href: '/agent', label: 'My runs', icon: 'riders' }] }]
  }
}

/** The permission each section needs; a link the caller cannot use is not shown. */
const NAV_PERMISSION: [prefix: string, permission: Permission][] = [
  ['/v2/orders', 'orders.view'],
  ['/v2/kitchen', 'kitchen.operate'],
  ['/v2/riders', 'riders.manage'],
  ['/v2/chat', 'chat.use'],
  ['/v2/calls', 'calls.operate'],
  ['/v2/inbox', 'inbox.review'],
  ['/v2/payments', 'payments.view'],
  ['/v2/menu', 'menu.manage'],
  ['/v2/analytics', 'analytics.view'],
  ['/v2/activity', 'activity.view'],
]

/** Drops the links whose section the caller's permissions do not open. */
export function filterNav(sections: V2NavSection[], perms: Set<Permission>): V2NavSection[] {
  return sections
    .map((sec) => ({
      ...sec,
      items: sec.items.filter((item) => {
        const rule = NAV_PERMISSION.find(([prefix]) => item.href.startsWith(prefix))
        return !rule || perms.has(rule[1])
      }),
    }))
    .filter((sec) => sec.items.length > 0)
}
