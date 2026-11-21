import type { ReactNode } from 'react'
import { LogOut } from 'lucide-react'
import { CommandPalette } from './CommandPalette'
import { NotificationsBell, type AlertItem } from './NotificationsBell'
import { ThemeSwitch } from './ThemeSwitch'
import { THEME_COOKIE, readThemeChoice } from '@/lib/v2/theme'
import { getSessionUser, redirectToLogin } from '@/lib/session'
import { logout } from '@/app/actions/session'
import { ROLE_LABEL } from '@/lib/roles'
import { Avatar, cx, v2Focus } from './ui'
import type { V2NavSection } from './SidebarNav'
import { ShellFrame } from './ShellFrame'
import { V2_SIDEBAR_COOKIE } from '@/lib/v2/sidebar'
import { cookies } from 'next/headers'
import { MobileNav } from './MobileNav'

/**
 * The v2 app frame: a white rounded workspace on the grey canvas, sidebar on
 * the left, top bar with search and the signed-in person, page content below.
 *
 * `tile` is the dark green card at the foot of the sidebar; the dashboard puts
 * the next arrival there. `outletLabel` is what the person is scoped to.
 */
export async function Shell({
  nav,
  tile,
  outletLabel,
  alerts = [],
  children,
}: {
  nav: V2NavSection[]
  tile?: ReactNode
  outletLabel?: string
  /** What the bell lists: things waiting on this person. */
  alerts?: AlertItem[]
  children: ReactNode
}) {
  const user = await getSessionUser()
  if (!user) return redirectToLogin()
  const jar = await cookies()
  const collapsed = jar.get(V2_SIDEBAR_COOKIE)?.value === 'collapsed'
  const theme = readThemeChoice(jar.get(THEME_COOKIE)?.value)

  const logoutForm = (
    <form action={logout}>
      <button
        type="submit"
        className={cx('flex w-full items-center gap-3 rounded-full px-3 py-2 text-sm font-medium text-v2-ink-2 hover:bg-v2-surface-2', v2Focus)}
      >
        <LogOut size={18} strokeWidth={1.8} className="text-v2-muted" aria-hidden />
        Log out
      </button>
    </form>
  )

  return (
    <div className="min-h-dvh bg-v2-bg font-v2 text-v2-ink antialiased lg:h-dvh lg:overflow-clip lg:p-4">
      <a
        href="#main"
        className={cx(
          'sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-v2-surface focus:px-3 focus:py-2 focus:text-sm focus:font-semibold',
          v2Focus,
        )}
      >
        Skip to content
      </a>

      <ShellFrame
        nav={nav}
        initialCollapsed={collapsed}
        tile={tile}
        logoutAction={logout}
        logo={
          <span className="relative inline-block h-[30px] w-[30px] shrink-0 rounded-[9px] bg-v2-brand" aria-hidden>
            <span className="absolute left-[7px] right-[7px] top-[9px] h-[3px] rounded bg-v2-mint" />
            <span className="absolute left-[7px] right-[11px] top-[17px] h-[3px] rounded bg-v2-mint" />
          </span>
        }
        topbar={
    <header className="flex items-center gap-3.5 rounded-v2-xl border border-v2-line bg-v2-surface px-4 py-3">
      <MobileNav sections={nav} footer={<>{tile}{logoutForm}</>} />
      <div className="text-[19px] font-extrabold tracking-[-0.02em] lg:hidden">RailServe</div>
      <CommandPalette nav={nav} />
      <span className="hidden items-center gap-1.5 text-xs font-semibold text-v2-muted sm:inline-flex">
        <span className="h-2 w-2 rounded-full bg-v2-brand shadow-[0_0_0_3px_var(--color-v2-brand-soft)]" aria-hidden />
        Live
      </span>
      <div className="ml-auto flex items-center gap-2.5">
        <ThemeSwitch initial={theme} />
        <NotificationsBell items={alerts} />
        <Avatar name={user.name} />
        <span className="hidden leading-tight sm:block">
          <b className="block text-sm font-bold">{user.name}</b>
          <small className="text-xs text-v2-muted">{outletLabel ?? ROLE_LABEL[user.role]}</small>
        </span>
      </div>
    </header>
        }
      >
        {children}
      </ShellFrame>
    </div>
  )
}
