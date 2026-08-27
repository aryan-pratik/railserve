import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'
import { logout } from '@/app/actions/session'
import type { Role } from '@/lib/roles'

const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Admin',
  STORE_MANAGER: 'Store manager',
  DELIVERY_AGENT: 'Delivery agent',
}

const ROLE_BADGE: Record<Role, string> = {
  ADMIN: 'bg-violet-100 text-violet-800 ring-violet-200',
  STORE_MANAGER: 'bg-amber-100 text-amber-800 ring-amber-200',
  DELIVERY_AGENT: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
}

export type NavItem = { href: string; label: string }

export async function AppShell({
  nav = [],
  children,
}: {
  nav?: NavItem[]
  children: React.ReactNode
}) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  let outlet: string | null = null
  if (user.restaurantId) {
    await connectDb()
    const r = await Restaurant.findById(user.restaurantId).select('name stationCode').lean()
    outlet = r ? `${r.name} · ${r.stationCode}` : null
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="no-print border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            RailServe
          </Link>

          <nav className="flex flex-wrap items-center gap-1">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <div className="text-right leading-tight">
              <div className="text-sm font-medium text-slate-900">{user.name}</div>
              {outlet ? <div className="text-xs text-slate-500">{outlet}</div> : null}
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${ROLE_BADGE[user.role]}`}
            >
              {ROLE_LABEL[user.role]}
            </span>
            <form action={logout}>
              <button
                type="submit"
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
    </div>
  )
}
