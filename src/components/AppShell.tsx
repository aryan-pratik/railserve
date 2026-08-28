import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'
import { logout } from '@/app/actions/session'
import { ROLE_HOME, ROLE_LABEL } from '@/lib/roles'
import { Sidebar } from './Sidebar'
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

  // A manager may hold several outlets; the sidebar displays which outlets
  // are active for this user session.
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
    <div className="flex min-h-dvh flex-col lg:flex-row bg-canvas text-ink">
      <Sidebar items={nav} user={sidebarUser} logoutAction={logout} />
      <main className="flex-1 min-w-0 w-full px-4 py-6 sm:px-6 lg:px-8 max-w-7xl">
        {children}
      </main>
    </div>
  )
}

