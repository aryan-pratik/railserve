import { AppShell } from '@/components/AppShell'
import { AdminOrderToaster } from '@/components/AdminOrderToaster'
import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { UnparsedInbox } from '@/lib/models'

export default async function AdminLayout({ children }: LayoutProps<'/admin'>) {
  // Coarse gate only — every page still enforces through the scoped repository.
  await requireRole('ADMIN')

  // An unparsed order is an order nobody is cooking, so the count rides in the
  // nav rather than waiting to be discovered on a page nobody opens.
  await connectDb()
  const unparsed = await UnparsedInbox.countDocuments({ resolved: false })

  return (
    <AppShell
      nav={[
        { href: '/admin', label: 'Orders', icon: 'orders' },
        { href: '/admin/orders', label: 'All orders', icon: 'list' },
        { href: '/admin/enquiries', label: 'Enquiries', icon: 'enquiries' },
        { href: '/admin/payments', label: 'Payments', icon: 'payments' },
        { href: '/admin/inbox', label: 'Inbox', icon: 'inbox', count: unparsed },
        { href: '/admin/trains', label: 'Train status', icon: 'runs' },
        { href: '/admin/analytics', label: 'Analytics', icon: 'analytics' },
        { href: '/admin/setup', label: 'Setup', icon: 'setup' },
      ]}
    >
      {children}
      {/* A quiet toast, not the store/agent screens' loud stays-until-
          dismissed banner: an admin isn't standing over a stove when a
          telecaller changes a status, so a self-clearing notice is enough. */}
      <AdminOrderToaster />
    </AppShell>
  )
}
