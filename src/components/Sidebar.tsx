'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NavLinks, type NavItem } from './NavLinks'
import { IconTrain, IconMenu, IconClose, IconSignOut } from './Icons'
import { IconButton, focusRing } from './ui'

export type SidebarUser = {
  name: string
  role: string
  roleLabel: string
  roleHome: string
  outlets: string[]
}

function Brand({ href }: { href: string }) {
  return (
    <Link href={href} className={`flex items-center gap-2.5 rounded-lg ${focusRing}`}>
      <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-white">
        <IconTrain size={18} />
      </span>
      <span className="text-base font-bold tracking-tight text-ink">
        Rail<span className="text-accent">Serve</span>
      </span>
    </Link>
  )
}

export function Sidebar({
  items,
  user,
  logoutAction,
}: {
  items: NavItem[]
  user: SidebarUser
  logoutAction: () => Promise<void>
}) {
  const pathname = usePathname()
  // The drawer is open for one pathname at a time. A navigation, including
  // back/forward, changes the pathname and so closes it with no effect.
  const [openAt, setOpenAt] = useState<string | null>(null)
  const open = openAt === pathname
  const setOpen = (next: boolean) => setOpenAt(next ? pathname : null)

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

  const content = (
    <div className="flex h-full flex-col p-4">
      <div className="flex items-center justify-between">
        <Brand href={user.roleHome} />
        <IconButton aria-label="Close menu" size="sm" className="lg:hidden" onClick={() => setOpen(false)}>
          <IconClose size={18} />
        </IconButton>
      </div>

      <div className="mt-6 min-h-0 flex-1 overflow-y-auto">
        <NavLinks items={items} onItemClick={() => setOpen(false)} />
      </div>

      <div className="mt-4 flex items-center gap-2.5 border-t border-line pt-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-xs font-semibold text-accent">
          {initials}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm font-medium text-ink" title={user.name}>
            {user.name}
          </div>
          <div className="truncate text-xs text-muted" title={user.outlets.join(', ') || undefined}>
            {user.roleLabel}
            {outletLabel ? ` · ${outletLabel}` : ''}
          </div>
        </div>
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
        {content}
      </div>

      {/* Desktop: a fixed column. */}
      <aside className="no-print hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-60 lg:shrink-0 lg:flex-col lg:border-r lg:border-line lg:bg-surface">
        {content}
      </aside>
    </>
  )
}
