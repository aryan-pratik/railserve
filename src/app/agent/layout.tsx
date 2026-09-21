import { AppShell } from '@/components/AppShell'
import { CancellationAlert } from '@/components/CancellationAlert'
import { requireRole } from '@/lib/session'

export default async function AgentLayout({ children }: LayoutProps<'/agent'>) {
  await requireRole('DELIVERY_AGENT')
  return (
    <AppShell nav={[{ href: '/agent', label: 'My runs', icon: 'runs' }]}>
      {children}
      {/*
        The rider is the last person who can still stop a cancelled order from
        leaving the counter, and the one least likely to be watching a screen.
        transitionOrder already refuses to dispatch it: this is so they do not
        carry it to the platform first and find out there.
      */}
      <CancellationAlert />
    </AppShell>
  )
}
