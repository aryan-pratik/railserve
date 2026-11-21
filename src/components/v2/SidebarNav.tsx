'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  LayoutGrid,
  ListOrdered,
  ChefHat,
  Bike,
  Phone,
  MessageCircle,
  Users,
  Inbox,
  CreditCard,
  Undo2,
  UtensilsCrossed,
  BarChart3,
  Activity,
  TrainFront,
  Settings,
  type LucideIcon,
} from 'lucide-react'
import { cx, v2Focus } from './ui'

export type V2NavItem = {
  href: string
  label: string
  icon: keyof typeof ICONS
  count?: number
  /** A red badge: something is wrong, not merely waiting. */
  alert?: boolean
}

export type V2NavSection = { label: string; items: V2NavItem[] }

const ICONS = {
  today: LayoutGrid,
  orders: ListOrdered,
  kitchen: ChefHat,
  riders: Bike,
  calls: Phone,
  chat: MessageCircle,
  enquiries: Users,
  inbox: Inbox,
  payments: CreditCard,
  returns: Undo2,
  menu: UtensilsCrossed,
  analytics: BarChart3,
  activity: Activity,
  trains: TrainFront,
  settings: Settings,
} satisfies Record<string, LucideIcon>

export function SidebarNav({ sections, collapsed = false }: { sections: V2NavSection[]; collapsed?: boolean }) {
  const pathname = usePathname()
  const search = useSearchParams()
  // An item that names a view (`?view=returns`) is active only on that view,
  // and the plain item for the same path is active on every other view.
  const isActive = (href: string, siblings: V2NavItem[]) => {
    const [path, query] = href.split('?')
    if (query) {
      const wanted = new URLSearchParams(query)
      return pathname === path && [...wanted].every(([k, v]) => search.get(k) === v)
    }
    if (path === '/v2/admin') return pathname === path
    if (!pathname.startsWith(path)) return false
    const viewed = siblings.some((it) => it.href !== href && it.href.startsWith(`${path}?`) && isActive(it.href, []))
    return !viewed
  }
  return (
    <nav className="grid content-start gap-0.5" aria-label="Main">
      {sections.map((section) => (
        <div key={section.label} className="grid gap-0.5">
          {collapsed ? (
            <span className="mx-4 my-2 block border-t border-v2-line" aria-hidden />
          ) : (
            <span className="px-[22px] pb-1.5 pt-3.5 text-[11px] font-bold uppercase tracking-[0.12em] text-v2-faint">
              {section.label}
            </span>
          )}
          {section.items.map((item) => {
            const Icon = ICONS[item.icon]
            const active = isActive(item.href, sections.flatMap((x) => x.items))
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                title={collapsed ? item.label : undefined}
                className={cx(
                  'relative flex items-center gap-3 py-[9px] text-sm transition-colors',
                  collapsed ? 'justify-center px-0' : 'px-[22px]',
                  active ? 'font-bold text-v2-ink' : 'font-medium text-v2-ink-2 hover:bg-v2-surface-2',
                  active &&
                    'before:absolute before:bottom-1.5 before:left-0 before:top-1.5 before:w-1 before:rounded-r before:bg-v2-brand',
                  v2Focus,
                )}
              >
                <span className="relative">
                  <Icon size={collapsed ? 20 : 18} strokeWidth={1.8} className={active ? 'text-v2-brand' : 'text-v2-muted'} aria-hidden />
                  {collapsed && item.count ? (
                    <span className={cx('absolute -right-1.5 -top-1 h-2.5 w-2.5 rounded-full ring-2 ring-v2-surface', item.alert ? 'bg-v2-bad' : 'bg-v2-brand')} aria-hidden />
                  ) : null}
                </span>
                {collapsed ? <span className="sr-only">{item.label}</span> : <span className="truncate">{item.label}</span>}
                {!collapsed && item.count ? (
                  <span
                    className={cx(
                      'ml-auto rounded-md px-1.5 py-px font-mono text-[11px] font-bold tabular-nums text-white',
                      item.alert ? 'bg-v2-bad' : 'bg-v2-brand',
                    )}
                  >
                    {item.count > 99 ? '99+' : item.count}
                  </span>
                ) : null}
              </Link>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
