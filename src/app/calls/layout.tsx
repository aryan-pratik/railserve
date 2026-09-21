import { AppShell } from '@/components/AppShell'
import { requireRole } from '@/lib/session'

/**
 * The telecaller's console.
 *
 * One nav entry, on purpose. A telecaller rings passengers and records the
 * one answer the rest of the system cannot find out on its own — that the
 * passenger has cancelled. Everything else a staff console normally carries
 * (money, payments, KOTs, dispatch, setup) is not part of that job, so it is
 * not part of this section: the refusals live in the repository, and the
 * absence here just means nobody has to click through something they are
 * going to be refused anyway.
 */
export default async function CallsLayout({ children }: LayoutProps<'/calls'>) {
  // Coarse gate only — every page still enforces through the scoped repository.
  await requireRole('TELECALLER')
  return (
    <AppShell nav={[{ href: '/calls', label: 'Call list', icon: 'phone' }]}>{children}</AppShell>
  )
}
