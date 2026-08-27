import { AppShell } from '@/components/AppShell'
import { requireRole } from '@/lib/session'

export default async function AdminLayout({ children }: LayoutProps<'/admin'>) {
  // Coarse gate only — every page still enforces through the scoped repository.
  await requireRole('ADMIN')
  return (
    <AppShell
      nav={[
        { href: '/admin/orders', label: 'Orders' },
        { href: '/admin/orders/new', label: 'New order' },
        { href: '/admin/runs', label: 'Runs' },
        { href: '/admin/restaurants', label: 'Outlets' },
        { href: '/admin/users', label: 'Staff' },
      ]}
    >
      {children}
    </AppShell>
  )
}
