import { AppShell } from '@/components/AppShell'
import { requireRole } from '@/lib/session'

/**
 * The telecaller's console.
 *
 * Three nav entries: the live board to work a train, the call list to find
 * one passenger, and Payments — a narrow, view-only exception to what is
 * otherwise a deliberately narrow role. A telecaller rings passengers and
 * records the outcomes the rest of the system cannot find out on its own
 * (cancelled, misdelivered, missed, refunded, or flagged as a decoy order),
 * and Payments exists purely so a call about "did my payment go through"
 * can be answered from the same screen — no balance, no export, no remark
 * editing, same restriction store manager's payments page already has.
 * Everything else a staff console normally carries (KOTs, dispatch, setup)
 * is still not part of this section: the refusals live in the repository,
 * and the absence here just means nobody has to click through something
 * they are going to be refused anyway.
 */
export default async function CallsLayout({ children }: LayoutProps<'/calls'>) {
  // Coarse gate only — every page still enforces through the scoped repository.
  await requireRole('TELECALLER')
  return (
    <AppShell
      nav={[
        { href: '/calls/live', label: 'Live board', icon: 'board' },
        { href: '/calls', label: 'Call list', icon: 'phone' },
        { href: '/calls/payments', label: 'Payments', icon: 'payments' },
      ]}
    >
      {children}
    </AppShell>
  )
}
