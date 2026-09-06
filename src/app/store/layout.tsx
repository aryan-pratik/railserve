import { AppShell } from '@/components/AppShell'
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
      ]}
    >
      {children}
    </AppShell>
  )
}
