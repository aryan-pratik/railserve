import { requireAuth } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { MenuItem, Restaurant, UnparsedInbox } from '@/lib/models'
import { countUnread } from '@/lib/repo/whatsappRepo'
import { countPendingReturns } from '@/lib/repo/rtoRepo'
import { listPendingCancelRequests } from '@/lib/repo/cancelRequestRepo'
import type { AlertItem } from '@/components/v2/NotificationsBell'
import { countLive } from '@/lib/board'
import { Shell } from '@/components/v2/Shell'
import { navFor } from '@/lib/v2/nav'

/**
 * The v2 shell for every signed-in role. Pages enforce their own role; this
 * only decides what the sidebar shows and what the person is scoped to.
 */
export default async function V2Layout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAuth()
  await connectDb()

  const isAdmin = ctx.role === 'ADMIN'
  const [live, unread, returns, unparsed, menuToCheck, outlets, cancelRequests] = await Promise.all([
    countLive(ctx),
    ctx.role === 'STORE_MANAGER' ? Promise.resolve(0) : countUnread(ctx),
    countPendingReturns(ctx),
    isAdmin ? UnparsedInbox.countDocuments({ resolved: false }) : Promise.resolve(0),
    isAdmin ? MenuItem.countDocuments({ removedAt: null, $or: [{ diet: null }, { reviewed: false }] }) : Promise.resolve(0),
    ctx.restaurantIds.length ? Restaurant.find({ _id: { $in: ctx.restaurantIds } }).select('name').sort({ name: 1 }).lean() : Promise.resolve([]),
    // Only the roles that can answer a cancel request are told about it.
    ctx.role === 'STORE_MANAGER' ? Promise.resolve([]) : listPendingCancelRequests(ctx, { limit: 8 }),
  ])

  const alerts: AlertItem[] = [
    ...cancelRequests.map((c) => ({
      id: `cancel-${c.id}`,
      title: `Cancel request · ${c.externalOrderId}`,
      sub: `${c.requestedBy}: ${c.reason}`,
      href: `/v2/orders/${c.id}?tab=calls`,
      tone: 'bad' as const,
    })),
    ...(returns ? [{ id: 'returns', title: `${returns} bag${returns === 1 ? '' : 's'} to collect`, sub: 'Returned to the counter, not yet received', href: '/v2/orders?view=returns', tone: 'warn' as const }] : []),
    ...(unparsed ? [{ id: 'inbox', title: `${unparsed} email${unparsed === 1 ? '' : 's'} did not become orders`, sub: 'Review them in the Inbox', href: '/v2/inbox', tone: 'info' as const }] : []),
  ]

  const outletLabel = isAdmin
    ? 'All outlets · admin'
    : outlets.length === 0
      ? undefined
      : outlets.length === 1
        ? outlets[0].name
        : `${outlets.length} outlets`

  return (
    <Shell nav={navFor(ctx.role, { live, unread, returns, unparsed, menuToCheck })} outletLabel={outletLabel} alerts={alerts}>
      {children}
    </Shell>
  )
}
