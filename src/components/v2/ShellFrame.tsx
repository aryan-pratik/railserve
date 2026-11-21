'use client'

import { useState, type ReactNode } from 'react'
import { LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { SidebarNav, type V2NavSection } from './SidebarNav'
import { cx, v2Focus } from './ui'

import { V2_SIDEBAR_COOKIE } from '@/lib/v2/sidebar'

/**
 * The frame's grid, as a client component so the sidebar can collapse to an
 * icon rail. The choice is kept in a cookie that the server reads on the next
 * render, so the page never paints wide and snaps narrow.
 *
 * The sidebar is sticky: it stays put while the content on the right scrolls,
 * and only scrolls itself when it is taller than the window.
 */
export function ShellFrame({
  nav,
  initialCollapsed,
  logo,
  tile,
  logoutAction,
  topbar,
  children,
}: {
  nav: V2NavSection[]
  initialCollapsed: boolean
  logo: ReactNode
  tile?: ReactNode
  logoutAction: () => Promise<void>
  topbar: ReactNode
  children: ReactNode
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed)

  function toggle() {
    const next = !collapsed
    setCollapsed(next)
    document.cookie = `${V2_SIDEBAR_COOKIE}=${next ? 'collapsed' : 'expanded'}; path=/; max-age=31536000; samesite=lax`
  }

  return (
    <div
      className={cx(
        // On a desktop the frame is the viewport: the window never scrolls, the main panel does.
        'mx-auto grid min-h-[calc(100dvh-2rem)] max-w-[1480px] grid-cols-1 gap-3.5 bg-v2-frame p-3.5 transition-[grid-template-columns] duration-200 lg:h-[calc(100dvh-2rem)] lg:min-h-0 lg:rounded-v2-2xl lg:shadow-v2-frame',
        collapsed ? 'lg:grid-cols-[72px_minmax(0,1fr)]' : 'lg:grid-cols-[216px_minmax(0,1fr)]',
      )}
    >
      <aside
        className={cx(
          'hidden min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-4 overflow-hidden rounded-v2-xl border border-v2-line bg-v2-surface py-[18px] lg:grid lg:h-full',
        )}
        aria-label="Sidebar"
      >
        <div className={cx('flex items-center gap-2', collapsed ? 'flex-col px-0' : 'justify-between pl-5 pr-3')}>
          <span className="flex items-center gap-2.5 text-[19px] font-extrabold tracking-[-0.02em]">
            {logo}
            {collapsed ? <span className="sr-only">RailServe</span> : 'RailServe'}
          </span>
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-full text-v2-muted hover:bg-v2-surface-2 hover:text-v2-ink', v2Focus)}
          >
            {collapsed ? <PanelLeftOpen size={18} strokeWidth={1.8} aria-hidden /> : <PanelLeftClose size={18} strokeWidth={1.8} aria-hidden />}
          </button>
        </div>
        {/* Only the nav scrolls; the logo above and the log-out below stay put. */}
        <div className="min-h-0 overflow-y-auto [overscroll-behavior:contain] [scrollbar-width:thin]">
          <SidebarNav sections={nav} collapsed={collapsed} />
        </div>
        <div className={cx('grid gap-3', collapsed ? 'px-2' : 'px-3.5')}>
          {collapsed ? null : tile}
          <form action={logoutAction}>
            <button
              type="submit"
              title={collapsed ? 'Log out' : undefined}
              className={cx(
                'flex w-full items-center gap-3 rounded-full py-2 text-sm font-medium text-v2-ink-2 hover:bg-v2-surface-2',
                collapsed ? 'justify-center px-0' : 'px-3',
                v2Focus,
              )}
            >
              <LogOut size={18} strokeWidth={1.8} className="text-v2-muted" aria-hidden />
              {collapsed ? <span className="sr-only">Log out</span> : 'Log out'}
            </button>
          </form>
        </div>
      </aside>

      <div className="grid min-h-0 min-w-0 gap-3.5 lg:grid-rows-[auto_minmax(0,1fr)]">
        {topbar}
        <main id="main" className="relative min-h-0 min-w-0 rounded-v2-xl border border-v2-line bg-v2-surface p-4 sm:p-[22px] lg:overflow-y-auto lg:[overscroll-behavior:contain]">
          {children}
        </main>
      </div>
    </div>
  )
}
