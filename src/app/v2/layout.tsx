import { getSessionUser, requireAuth } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { MenuItem, Restaurant, UnparsedInbox } from '@/lib/models'
import { countUnread } from '@/lib/repo/whatsappRepo'
import { countPendingReturns } from '@/lib/repo/rtoRepo'
import { listPendingCancelRequests } from '@/lib/repo/cancelRequestRepo'
import type { AlertItem } from '@/components/v2/NotificationsBell'
import type { StatusIssue } from '@/components/v2/StatusIcon'
import { isSimulatedProvider } from '@/lib/train'
import { trainFeedHealth } from '@/lib/train/service'
import { checkIngestStaleness } from '@/lib/ingest/gmail/sync'
import { countLive } from '@/lib/board'
import { Shell } from '@/components/v2/Shell'
import { filterNav, navFor } from '@/lib/v2/nav'
import { permissionsOf } from '@/lib/access'

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
    isAdmin ? UnparsedInbox.countDocuments({ tenantId: ctx.tenantId, resolved: false }) : Promise.resolve(0),
    isAdmin ? MenuItem.countDocuments({ tenantId: ctx.tenantId, removedAt: null, $or: [{ diet: null }, { reviewed: false }] }) : Promise.resolve(0),
    ctx.restaurantIds.length ? Restaurant.find({ _id: { $in: ctx.restaurantIds }, tenantId: ctx.tenantId }).select('name').sort({ name: 1 }).lean() : Promise.resolve([]),
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

  // Problems with the system itself, for the warning icon in the top bar.
  // Riders never see the shell; the email check is the owner's business.
  const [feed, ingest] = await Promise.all([
    isSimulatedProvider() ? Promise.resolve(null) : trainFeedHealth(),
    isAdmin ? checkIngestStaleness(new Date(), ctx.tenantId) : Promise.resolve(null),
  ])
  const issues: StatusIssue[] = [
    ...(isSimulatedProvider()
      ? [{ id: 'train-practice', level: 'amber' as const, title: 'Train times are practice times', detail: 'They are not real. Do not send riders by them.' }]
      : feed && feed.failing && feed.failingTrains.length >= feed.trainsTried
        ? [{ id: 'train-down', level: 'red' as const, title: 'Live train times are not working', detail: 'Times shown are from the timetable, so trains may be later. Check with the station before sending a rider.' }]
        : []),
    ...(ingest?.stale
      ? [{ id: 'email-stopped', level: 'red' as const, title: 'Orders from email stopped coming in', detail: 'New orders may be missing. Add urgent ones by hand and check the emails page.', action: { label: 'Check emails', href: '/v2/inbox' } }]
      : []),
  ]

  const user = await getSessionUser()
  const company = user?.tenantName ?? ''
  const outletLabel = isAdmin
    ? `${company || 'All outlets'} · admin`
    : outlets.length === 0
      ? undefined
      : outlets.length === 1
        ? outlets[0].name
        : `${outlets.length} outlets`

  return (
    <Shell
      nav={[
        ...filterNav(navFor(ctx.role, { live, unread, returns, unparsed, menuToCheck }), await permissionsOf(ctx)),
        // Our own super admins also see the platform console.
        ...(user?.platformAdmin ? [{ label: 'Platform', items: [{ href: '/platform', label: 'Companies', icon: 'platform' as const }] }] : []),
      ]}
      outletLabel={outletLabel}
      alerts={alerts}
      issues={issues}
    >
      {children}
    </Shell>
  )
}
