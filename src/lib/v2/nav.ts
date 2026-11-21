import type { Role } from '@/lib/roles'
import type { V2NavSection } from '@/components/v2/SidebarNav'

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
            { href: '/v2/kitchen', label: 'Kitchen', icon: 'kitchen' },
            { href: '/v2/riders', label: 'Riders', icon: 'riders' },
            { href: '/v2/chat', label: 'WhatsApp', icon: 'chat', count: c.unread },
          ],
        },
        {
          label: 'Review',
          items: [
            { href: '/v2/inbox', label: 'Inbox', icon: 'inbox', count: c.unparsed, alert: true },
            { href: '/v2/payments', label: 'Payments', icon: 'payments' },
            { href: '/v2/menu', label: 'Menu', icon: 'menu', count: c.menuToCheck },
            { href: '/v2/analytics', label: 'Analytics', icon: 'analytics' },
            { href: '/v2/activity', label: 'Activity', icon: 'activity' },
          ],
        },
        { label: 'General', items: [{ href: '/v2/settings', label: 'Settings', icon: 'settings' }] },
      ]
    case 'STORE_MANAGER':
      return [
        {
          label: 'Kitchen',
          items: [
            { href: '/v2/kitchen', label: 'Kitchen board', icon: 'kitchen', count: c.live },
            { href: '/v2/orders', label: 'Orders', icon: 'orders' },
            { href: '/v2/orders?view=returns', label: 'Returns', icon: 'returns', count: c.returns },
            { href: '/v2/riders', label: 'Riders', icon: 'riders' },
            { href: '/v2/payments', label: 'Payments', icon: 'payments' },
          ],
        },
      ]
    case 'TELECALLER':
      return [
        {
          label: 'Call desk',
          items: [
            { href: '/v2/calls', label: 'Call board', icon: 'calls', count: c.live },
            { href: '/v2/orders', label: 'Orders', icon: 'orders' },
            { href: '/v2/chat', label: 'WhatsApp', icon: 'chat', count: c.unread },
            { href: '/v2/orders?view=returns', label: 'Returns', icon: 'returns', count: c.returns },
            { href: '/v2/payments', label: 'Payments', icon: 'payments' },
          ],
        },
      ]
    case 'DELIVERY_AGENT':
      return [{ label: 'Rider', items: [{ href: '/agent', label: 'My runs', icon: 'riders' }] }]
  }
}
