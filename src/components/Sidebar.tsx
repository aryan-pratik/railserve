'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { NavLinks, type NavItem } from './NavLinks'
import { IconTrain, IconMenu, IconClose, IconSignOut } from './Icons'

export type SidebarUser = {
  name: string
  role: string
  roleLabel: string
  roleHome: string
  outlets: string[]
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
  const [mobileOpen, setMobileOpen] = useState(false)

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false)
    }
    if (mobileOpen) {
      document.addEventListener('keydown', handleKeyDown)
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [mobileOpen])

  // Get user initials for avatar
  const initials = user.name
    .split(' ')
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'RS'

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between p-4">
      <div className="space-y-6">
        {/* Brand Header */}
        <div className="flex items-center justify-between px-2">
          <Link
            href={user.roleHome}
            className="flex items-center gap-3 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-lg"
          >
            <div className="flex size-10 items-center justify-center rounded-xl bg-accent text-white shadow-xs transition-transform group-hover:scale-105">
              <IconTrain size={22} />
            </div>
            <div className="leading-tight">
              <div className="flex items-center gap-1.5 font-bold text-base tracking-tight text-ink">
                Rail<span className="text-accent">Serve</span>
              </div>
              <span className="text-[11px] font-medium text-muted tracking-wide">
                Train Food Delivery
              </span>
            </div>
          </Link>

          {/* Close button for mobile drawer */}
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation menu"
            className="lg:hidden rounded-lg p-1.5 text-muted hover:bg-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <IconClose size={20} />
          </button>
        </div>

        {/* Navigation Items */}
        <div>
          <div className="px-2 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">
              Navigation
            </span>
          </div>
          <NavLinks items={items} onItemClick={() => setMobileOpen(false)} />
        </div>
      </div>

      {/* Bottom User Profile Section */}
      <div className="space-y-3 pt-4 border-t border-line">
        <div className="flex items-center justify-between gap-2.5 rounded-xl border border-line bg-surface p-2.5 shadow-2xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft font-semibold text-xs text-accent ring-1 ring-accent/20">
              {initials}
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-xs font-semibold text-ink" title={user.name}>
                {user.name}
              </div>
              <div className="flex items-center gap-1 mt-0.5 text-[11px] text-muted">
                <span className="truncate">{user.roleLabel}</span>
                {user.outlets.length > 0 ? (
                  <span
                    className="truncate text-faint"
                    title={user.outlets.join(', ')}
                  >
                    · {user.outlets.length === 1 ? user.outlets[0] : `${user.outlets.length} outlets`}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <form action={logoutAction}>
            <button
              type="submit"
              title="Sign out"
              aria-label="Sign out"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-faint transition hover:bg-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <IconSignOut size={16} />
            </button>
          </form>
        </div>
      </div>
    </div>
  )

  return (
    <>
      {/* Mobile Top Header */}
      <header className="no-print sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface/95 px-4 py-3 backdrop-blur lg:hidden">
        <Link href={user.roleHome} className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-accent text-white">
            <IconTrain size={18} />
          </div>
          <span className="font-bold text-sm tracking-tight text-ink">
            Rail<span className="text-accent">Serve</span>
          </span>
        </Link>

        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-expanded={mobileOpen}
          aria-label="Open navigation menu"
          className="flex size-9 items-center justify-center rounded-lg border border-line bg-surface text-ink shadow-2xs hover:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <IconMenu size={19} />
        </button>
      </header>

      {/* Mobile Drawer Backdrop */}
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-[2px] transition-opacity lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      {/* Mobile Drawer Panel */}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] transform bg-surface shadow-2xl transition-transform duration-200 ease-out lg:hidden ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation Menu"
      >
        {sidebarContent}
      </div>

      {/* Desktop Persistent Sidebar */}
      <aside className="no-print hidden lg:flex lg:w-64 lg:shrink-0 lg:flex-col lg:border-r lg:border-line lg:bg-surface lg:min-h-dvh lg:sticky lg:top-0">
        {sidebarContent}
      </aside>
    </>
  )
}
