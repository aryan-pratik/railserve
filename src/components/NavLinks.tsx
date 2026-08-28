'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  IconOrders,
  IconList,
  IconEnquiries,
  IconInbox,
  IconAnalytics,
  IconSetup,
  IconBoard,
  IconHistory,
  IconRuns,
  IconDashboard,
} from './Icons'

export type NavItem = {
  href: string
  label: string
  icon?: string
  count?: number
  description?: string
}

const ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  orders: IconOrders,
  list: IconList,
  enquiries: IconEnquiries,
  inbox: IconInbox,
  analytics: IconAnalytics,
  setup: IconSetup,
  board: IconBoard,
  history: IconHistory,
  runs: IconRuns,
  dashboard: IconDashboard,
}

export function NavLinks({
  items,
  onItemClick,
}: {
  items: NavItem[]
  onItemClick?: () => void
}) {
  const pathname = usePathname()

  return (
    <nav className="space-y-1" aria-label="Main Navigation">
      {items.map((item) => {
        const IconComponent = (item.icon && ICONS[item.icon]) ? ICONS[item.icon] : IconOrders
        const isRootPage = item.href === '/admin' || item.href === '/store' || item.href === '/agent'
        const active = isRootPage
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`)

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onItemClick}
            aria-current={active ? 'page' : undefined}
            className={`group flex items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all duration-150 ${
              active
                ? 'bg-accent-soft text-accent shadow-xs font-semibold'
                : 'text-muted hover:bg-sunken hover:text-ink'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <IconComponent
                size={19}
                className={`shrink-0 transition-colors ${
                  active ? 'text-accent' : 'text-faint group-hover:text-ink'
                }`}
              />
              <span className="truncate">{item.label}</span>
            </div>

            {item.count !== undefined && item.count > 0 ? (
              <span
                className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums transition-colors ${
                  active
                    ? 'bg-accent text-white'
                    : 'bg-red-600 text-white'
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
