import { AppShell } from '@/components/AppShell'
import { requireRole } from '@/lib/session'

export default async function AgentLayout({ children }: LayoutProps<'/agent'>) {
  await requireRole('DELIVERY_AGENT')
  return <AppShell nav={[{ href: '/agent', label: 'My runs' }]}>{children}</AppShell>
}
