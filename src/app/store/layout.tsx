import { AppShell } from '@/components/AppShell'
import { CancellationAlert } from '@/components/CancellationAlert'
import { requireRole } from '@/lib/session'

export default async function StoreLayout({ children }: LayoutProps<'/store'>) {
  // Coarse gate only — every page still enforces through the scoped repository.
  await requireRole('STORE_MANAGER', 'ADMIN')
  return (
    <AppShell
      nav={[
        { href: '/store', label: 'Kitchen board', icon: 'board' },
        { href: '/store/history', label: 'Order history', icon: 'history' },
        { href: '/store/payments', label: 'Payments', icon: 'payments' },
        { href: '/store/staff', label: 'Riders', icon: 'setup' },
      ]}
    >
      {children}
      {/*
        In the layout, not on the board: a cancellation has to reach the
        manager wherever they are in this section: including the order page
        for the very order being cancelled, which otherwise just sits there
        showing a status that stopped being true.
      */}
      <CancellationAlert />
    </AppShell>
  )
}
