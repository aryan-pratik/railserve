import { AppShell } from '@/components/AppShell'
import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { countUnread } from '@/lib/repo/whatsappRepo'

/**
 * The telecaller's console.
 *
 * Four nav entries: the live board to work a train, the call list to find
 * one passenger, WhatsApp to answer the one who wrote instead of ringing,
 * and Payments — a narrow, view-only exception to what is
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
  const ctx = await requireRole('TELECALLER')
  await connectDb()
  // Passengers waiting for a reply, on the nav item itself: a telecaller on
  // the live board should not have to open the chat to learn someone wrote.
  const unread = await countUnread(ctx)
  return (
    <AppShell
      nav={[
        { href: '/calls/live', label: 'Live board', icon: 'board' },
        { href: '/calls', label: 'Call list', icon: 'phone' },
        { href: '/calls/chat', label: 'WhatsApp', icon: 'chat', count: unread },
        { href: '/calls/payments', label: 'Payments', icon: 'payments' },
      ]}
    >
      {children}
    </AppShell>
  )
}
