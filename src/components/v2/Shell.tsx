import type { ReactNode } from 'react'
import { LogOut } from 'lucide-react'
import { CommandPalette } from './CommandPalette'
import { NotificationsBell, type AlertItem } from './NotificationsBell'
import { StatusIcon, type StatusIssue } from './StatusIcon'
import Link from 'next/link'
import { getSessionUser, redirectToLogin } from '@/lib/session'
import { logout } from '@/app/actions/session'
import { ROLE_LABEL } from '@/lib/roles'
import { Avatar, cx, v2Focus } from './ui'
import type { V2NavSection } from './SidebarNav'
import { ShellFrame } from './ShellFrame'
import { V2_SIDEBAR_COOKIE } from '@/lib/v2/sidebar'
import { cookies } from 'next/headers'
import { MobileNav } from './MobileNav'
import { MenuButton } from './Floating'

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
  issues = [],
  children,
}: {
  nav: V2NavSection[]
  tile?: ReactNode
  outletLabel?: string
  /** What the bell lists: things waiting on this person. */
  alerts?: AlertItem[]
  /** What the warning icon lists: problems with the system itself. */
  issues?: StatusIssue[]
  children: ReactNode
}) {
  const user = await getSessionUser()
  if (!user) return redirectToLogin()
  const jar = await cookies()
  // Store managers start with the narrow icon strip so the kitchen list gets
  // the width; anyone can open it, and their choice is remembered.
  const sidebarChoice = jar.get(V2_SIDEBAR_COOKIE)?.value
  const collapsed = sidebarChoice ? sidebarChoice === 'collapsed' : user.role === 'STORE_MANAGER'

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
      <div className="ml-auto flex min-w-0 items-center gap-2">
        <StatusIcon issues={issues} />
        <NotificationsBell items={alerts} />
        {/* Just your initials; a tap opens a short menu with who you are and the few account things. */}
        <MenuButton
          label={<Avatar name={user.name} />}
          ariaLabel={`${user.name}: account menu`}
          buttonClassName="rounded-full"
          panelClassName="w-64"
        >
          <div className="px-3 py-2">
            <b className="block text-[15px] font-bold">{user.name}</b>
            <small className="text-[13px] text-v2-muted">{outletLabel ?? ROLE_LABEL[user.role]}</small>
          </div>
          <Link href={user.role === 'ADMIN' ? '/v2/settings' : '/v2/account'} className={cx('rounded-v2-sm px-3 py-2.5 text-[14.5px] font-semibold hover:bg-v2-surface-2', v2Focus)}>
            Settings
          </Link>
          {logoutForm}
        </MenuButton>
      </div>
    </header>
        }
      >
        {children}
      </ShellFrame>
    </div>
  )
}
