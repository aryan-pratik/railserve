import { AppShell } from '@/components/AppShell'
import { CancellationAlert } from '@/components/CancellationAlert'
import { requireRole } from '@/lib/session'
import { countPendingReturns } from '@/lib/repo/rtoRepo'

export default async function StoreLayout({ children }: LayoutProps<'/store'>) {
  // Coarse gate only — every page still enforces through the scoped repository.
  const ctx = await requireRole('STORE_MANAGER', 'ADMIN')
  // Bags on their way back, on the nav item: a manager should not have to
  // open the list to learn a rider is bringing food back to the counter.
  const returns = await countPendingReturns(ctx)
  return (
    <AppShell
      nav={[
        { href: '/store', label: 'Kitchen board', icon: 'board' },
        { href: '/store/returns', label: 'Returns', icon: 'bag', count: returns },
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
