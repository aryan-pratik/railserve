import { AppShell } from '@/components/AppShell'
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
        { href: '/admin/orders', label: 'All Orders', icon: 'list' },
        { href: '/admin/enquiries', label: 'Enquiries', icon: 'enquiries' },
        { href: '/admin/inbox', label: 'Inbox', icon: 'inbox', count: unparsed },
        { href: '/admin/trains', label: 'Train status', icon: 'runs' },
        { href: '/admin/analytics', label: 'Analytics', icon: 'analytics' },
        { href: '/admin/setup', label: 'Setup', icon: 'setup' },
      ]}
    >
      {children}
    </AppShell>
  )
}
