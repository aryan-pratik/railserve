'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NavLinks, type NavItem } from './NavLinks'
import { IconTrain, IconMenu, IconClose, IconSignOut, IconChevronLeft, IconChevronRight } from './Icons'
import { IconButton, focusRing } from './ui'
import { SIDEBAR_COOKIE } from '@/lib/sidebar'

export type SidebarUser = {
  name: string
  role: string
  roleLabel: string
  roleHome: string
  outlets: string[]
}

function Brand({ href, compact = false }: { href: string; compact?: boolean }) {
  return (
    <Link href={href} aria-label={compact ? 'RailServe' : undefined} className={`flex items-center gap-2.5 rounded-lg ${focusRing}`}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-white">
        <IconTrain size={18} />
      </span>
      {compact ? null : (
        <span className="text-base font-bold tracking-tight text-ink">
          Rail<span className="text-accent">Serve</span>
        </span>
      )}
    </Link>
  )
}

export function Sidebar({
  items,
  user,
  logoutAction,
  initialCollapsed = false,
}: {
  items: NavItem[]
  user: SidebarUser
  logoutAction: () => Promise<void>
  /** Desktop only. The phone drawer always opens at full width. */
  initialCollapsed?: boolean
}) {
  const pathname = usePathname()
  // The drawer is open for one pathname at a time. A navigation, including
  // back/forward, changes the pathname and so closes it with no effect.
  const [openAt, setOpenAt] = useState<string | null>(null)
  const open = openAt === pathname
  const setOpen = (next: boolean) => setOpenAt(next ? pathname : null)

  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const toggleCollapsed = () => {
    const next = !collapsed
    setCollapsed(next)
    document.cookie = `${SIDEBAR_COOKIE}=${next ? 'collapsed' : 'expanded'}; path=/; max-age=31536000; samesite=lax`
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [open])

  const initials =
    user.name
      .split(' ')
      .map((n) => n[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || 'RS'

  const outletLabel =
    user.outlets.length === 0
      ? null
      : user.outlets.length === 1
        ? user.outlets[0]
        : `${user.outlets.length} outlets`

  // The drawer is always full width; only the desktop column collapses.
  const renderContent = (compact: boolean) => (
    <div className={`flex h-full flex-col ${compact ? 'items-center px-2 py-4' : 'p-4'}`}>
      <div className={`flex items-center ${compact ? 'flex-col gap-3' : 'justify-between'}`}>
        <Brand href={user.roleHome} compact={compact} />
        <IconButton aria-label="Close menu" size="sm" className="lg:hidden" onClick={() => setOpen(false)}>
          <IconClose size={18} />
        </IconButton>
        <IconButton
          aria-label={compact ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!compact}
          size="sm"
          className="hidden lg:inline-flex"
          onClick={toggleCollapsed}
        >
          {compact ? <IconChevronRight size={16} /> : <IconChevronLeft size={16} />}
        </IconButton>
      </div>

      <div className={`mt-6 min-h-0 flex-1 overflow-y-auto ${compact ? 'w-full' : ''}`}>
        <NavLinks items={items} compact={compact} onItemClick={() => setOpen(false)} />
      </div>

      <div className={`mt-4 flex items-center border-t border-line pt-4 ${compact ? 'w-full flex-col gap-2' : 'gap-2.5'}`}>
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-xs font-semibold text-accent"
          title={compact ? `${user.name} · ${user.roleLabel}${outletLabel ? ` · ${outletLabel}` : ''}` : undefined}
        >
          {initials}
        </span>
        {compact ? null : (
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-medium text-ink" title={user.name}>
              {user.name}
            </div>
            <div className="truncate text-xs text-muted" title={user.outlets.join(', ') || undefined}>
              {user.roleLabel}
              {outletLabel ? ` · ${outletLabel}` : ''}
            </div>
          </div>
        )}
        <form action={logoutAction}>
          <IconButton type="submit" aria-label="Sign out" size="sm">
            <IconSignOut size={16} />
          </IconButton>
        </form>
      </div>
    </div>
  )

  return (
    <>
      {/* Phone: a top bar with a menu button. */}
      <header className="no-print sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface px-4 py-2.5 lg:hidden">
        <Brand href={user.roleHome} />
        <IconButton aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)} className="border border-line bg-surface">
          <IconMenu size={19} />
        </IconButton>
      </header>

      {open ? (
        <div
          className="fixed inset-0 z-40 bg-ink/30 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      {/* Drawer. Inert while closed so nothing inside it can take focus. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        inert={!open}
        className={`fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-surface shadow-2xl transition-transform duration-200 ease-out motion-reduce:transition-none lg:hidden ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {renderContent(false)}
      </div>

      {/* Desktop: a fixed column, collapsible to an icon rail. */}
      <aside
        className={`no-print hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:shrink-0 lg:flex-col lg:border-r lg:border-line lg:bg-surface lg:transition-[width] lg:duration-200 motion-reduce:transition-none ${
          collapsed ? 'lg:w-16' : 'lg:w-60'
        }`}
      >
        {renderContent(collapsed)}
      </aside>
    </>
  )
}
