'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { focusRing } from './ui'
import { LinkHint } from './LinkHint'
import {
  IconOrders,
  IconList,
  IconEnquiries,
  IconInbox,
  IconPayments,
  IconAnalytics,
  IconSetup,
  IconBoard,
  IconHistory,
  IconRuns,
} from './Icons'

export type NavItem = {
  href: string
  label: string
  icon?: string
  count?: number
}

const ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  orders: IconOrders,
  list: IconList,
  enquiries: IconEnquiries,
  inbox: IconInbox,
  payments: IconPayments,
  analytics: IconAnalytics,
  setup: IconSetup,
  board: IconBoard,
  history: IconHistory,
  runs: IconRuns,
}

const ROOTS = new Set(['/admin', '/store', '/agent'])

export function NavLinks({
  items,
  onItemClick,
}: {
  items: NavItem[]
  onItemClick?: () => void
}) {
  const pathname = usePathname()

  return (
    <nav className="space-y-0.5" aria-label="Main">
      {items.map((item) => {
        const Icon = (item.icon && ICONS[item.icon]) || IconOrders
        // A section root only matches itself; /admin must not light up on /admin/orders.
        const active = ROOTS.has(item.href)
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`)

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onItemClick}
            aria-current={active ? 'page' : undefined}
            className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${focusRing} ${
              active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-sunken hover:text-ink'
            }`}
          >
            <Icon
              size={18}
              className={`shrink-0 ${active ? 'text-accent' : 'text-faint group-hover:text-ink'}`}
            />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            <LinkHint />
            {item.count ? (
              <span
                className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${
                  active ? 'bg-accent text-white' : 'bg-red-600 text-white'
                }`}
              >
                {item.count}
              </span>
            ) : null}
          </Link>
        )
      })}
    </nav>
  )
}
