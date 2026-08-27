import { AppShell } from '@/components/AppShell'
import { requireRole } from '@/lib/session'

export default async function StoreLayout({ children }: LayoutProps<'/store'>) {
  await requireRole('STORE_MANAGER', 'ADMIN')
  return <AppShell nav={[{ href: '/store', label: 'Today' }]}>{children}</AppShell>
}
