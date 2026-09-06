import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'
import { logout } from '@/app/actions/session'
import { ROLE_HOME, ROLE_LABEL } from '@/lib/roles'
import { Sidebar } from './Sidebar'
import { TopProgress } from './TopProgress'
import type { NavItem } from './NavLinks'

export type { NavItem }

export async function AppShell({
  nav = [],
  children,
}: {
  nav?: NavItem[]
  children: React.ReactNode
}) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  // A manager may hold several outlets; the sidebar says which.
  let outlets: string[] = []
  if (user.restaurantIds?.length) {
    await connectDb()
    const rs = await Restaurant.find({ _id: { $in: user.restaurantIds } })
      .select('name')
      .sort({ name: 1 })
      .lean()
    outlets = rs.map((r) => r.name)
  }

  const sidebarUser = {
    name: user.name,
    role: user.role,
    roleLabel: ROLE_LABEL[user.role] ?? user.role,
    roleHome: ROLE_HOME[user.role],
    outlets,
  }

  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-ink lg:flex-row">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-ink focus:ring-2 focus:ring-accent"
      >
        Skip to content
      </a>
      <Sidebar items={nav} user={sidebarUser} logoutAction={logout} />
      <div className="relative min-w-0 flex-1">
        <TopProgress />
        <main id="main" className="w-full max-w-7xl min-w-0 px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
          {children}
        </main>
      </div>
    </div>
  )
}
