import Link from 'next/link'
import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { User } from '@/lib/models'
import { teamView, type TeamMember } from '@/lib/repo/teamRepo'
import { opsDayCaption, opsDayOf } from '@/lib/opsDay'
import { formatIST, formatRupees } from '@/lib/format'
import { ButtonLink, Card, CardHeader, EmptyState, PageHeader, focusRing, thClass } from '@/components/ui'
import { TeamMover } from './TeamMover'

export const metadata = { title: 'Rider teams · RailServe' }
export const dynamic = 'force-dynamic'

/**
 * Rider teams: each team leader, the riders under them, and the day each has
 * had. The figures are the rider ledger's, for the same 3am-to-3am day the
 * riders and their leader see in the app.
 *
 * A team leader is made in Setup, Staff (role "Rider team leader"). Riders
 * are placed under one here, or on the rider's own staff record.
 */
export default async function TeamsPage(props: PageProps<'/admin/riders/teams'>) {
  const ctx = await requireRole('ADMIN')
  const sp = await props.searchParams
  const asked = Array.isArray(sp.date) ? sp.date[0] : sp.date
  const today = opsDayOf()
  const day = /^\d{4}-\d{2}-\d{2}$/.test(asked ?? '') ? asked! : today

  await connectDb()
  const [leads, riders] = await Promise.all([
    User.find({ role: 'DELIVERY_AGENT', isTeamLead: true }).select('name active').sort({ active: -1, name: 1 }).lean(),
    User.find({ role: 'DELIVERY_AGENT', isTeamLead: { $ne: true }, active: true })
      .select('name teamLeadId')
      .sort({ name: 1 })
      .lean(),
  ])
  const teams = await Promise.all(leads.map((l) => teamView(ctx, l._id, { day })))
  const leadName = new Map(leads.map((l) => [String(l._id), l.name]))

  return (
    <div className="space-y-4">
      <PageHeader
        back={{ href: '/admin/riders', label: 'Riders' }}
        title="Rider teams"
        note={`Each team leader and the riders under them. Figures are for ${opsDayCaption(day)}; cash due is across all days.`}
        action={<ButtonLink href="/admin/setup?tab=staff">Add a team leader</ButtonLink>}
      />

      <Card className="p-3">
        <form action="/admin/riders/teams" className="flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="date" className="text-muted">Reporting day</label>
          <input id="date" type="date" name="date" defaultValue={day} max={today}
            className="rounded-lg border border-line-strong bg-surface px-3 py-1.5" />
          <button type="submit" className={`rounded-lg border border-line-strong px-3 py-1.5 font-medium text-ink hover:bg-sunken ${focusRing}`}>
            Show
          </button>
        </form>
      </Card>

      {teams.length === 0 ? (
        <EmptyState
          title="No team leaders yet"
          note="Make a rider a team leader in Setup, Staff by setting their role to Rider team leader. Then place riders under them here."
        />
      ) : (
        teams.map((t) => (
          <Card key={t.lead.id} className="overflow-hidden">
            <CardHeader
              title={
                <>
                  Team {t.lead.name}
                  <span className="ml-2 text-xs font-normal text-muted">
                    {t.members.length - 1} rider{t.members.length === 2 ? '' : 's'}
                    {t.lead.canReceiveCash ? ' · leader may receive cash' : ' · leader may not receive cash'}
                  </span>
                </>
              }
              action={
                <Link href={`/admin/setup?tab=staff&edit=${t.lead.id}`} className={`rounded text-sm font-medium text-accent hover:underline ${focusRing}`}>
                  Leader’s account
                </Link>
              }
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-sm">
                <thead className="border-b border-line bg-canvas">
                  <tr>
                    <th className={thClass}>Rider</th>
                    <th className={`${thClass} text-right`}>In hand</th>
                    <th className={`${thClass} text-right`}>Delivered</th>
                    <th className={`${thClass} text-right`}>Not delivered</th>
                    <th className={`${thClass} text-right`}>Cancelled</th>
                    <th className={`${thClass} text-right`}>COD collected</th>
                    <th className={`${thClass} text-right`}>COD due</th>
                    <th className={thClass}>Last handed in</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {t.members.map((m) => <MemberRow key={m.id} m={m} />)}
                  <TotalRow members={t.members} />
                </tbody>
              </table>
            </div>
          </Card>
        ))
      )}

      <Card className="overflow-hidden">
        <CardHeader title="Move riders between teams" />
        <TeamMover
          riders={riders.map((r) => ({
            id: String(r._id),
            name: r.name,
            team: r.teamLeadId ? `team ${leadName.get(String(r.teamLeadId)) ?? 'unknown'}` : null,
          }))}
          leads={leads.filter((l) => l.active !== false).map((l) => ({ id: String(l._id), name: l.name }))}
        />
      </Card>
    </div>
  )
}

const td = 'px-3 py-2.5 align-top tabular-nums'

function MemberRow({ m }: { m: TeamMember }) {
  return (
    <tr className={m.active ? '' : 'text-faint'}>
      <td className="px-3 py-2.5 align-top">
        <Link href={`/admin/riders/${m.id}`} className={`rounded font-medium text-accent hover:underline ${focusRing}`}>
          {m.name}
        </Link>
        {m.isLead ? <span className="ml-1.5 text-xs text-faint">leader</span> : null}
        {m.active ? null : <span className="ml-1.5 text-xs">inactive</span>}
      </td>
      <td className={`${td} text-right`}>
        {m.now.inHand}
        {m.now.stale > 0 ? <span className="block text-xs font-normal text-muted">+{m.now.stale} old</span> : null}
      </td>
      <td className={`${td} text-right text-emerald-800`}>{m.day.delivered}</td>
      <td className={`${td} text-right`}>{m.day.notDelivered}</td>
      <td className={`${td} text-right`}>{m.day.cancelled}</td>
      <td className={`${td} text-right`}>
        {formatRupees(m.day.codPaise)}
        <span className="block text-xs text-faint">{m.day.codOrders} COD</span>
      </td>
      <td className={`${td} text-right font-semibold ${m.due.paise > 0 ? 'text-amber-800' : 'text-ink'}`}>
        {formatRupees(m.due.paise)}
        <span className="block text-xs font-normal text-faint">{m.due.orders} order{m.due.orders === 1 ? '' : 's'}</span>
      </td>
      <td className="px-3 py-2.5 align-top text-xs text-muted">
        {m.lastCollection ? (
          <>
            {formatRupees(m.lastCollection.paise)} · {formatIST(m.lastCollection.at)}
            {m.lastCollection.receivedBy ? <span className="block text-faint">to {m.lastCollection.receivedBy}</span> : null}
          </>
        ) : (
          'Never'
        )}
      </td>
    </tr>
  )
}

function TotalRow({ members }: { members: TeamMember[] }) {
  const sum = (f: (m: TeamMember) => number) => members.reduce((a, m) => a + f(m), 0)
  return (
    <tr className="bg-canvas font-semibold text-ink">
      <td className="px-3 py-2.5">Team total</td>
      <td className={`${td} text-right`}>{sum((m) => m.now.inHand)}</td>
      <td className={`${td} text-right`}>{sum((m) => m.day.delivered)}</td>
      <td className={`${td} text-right`}>{sum((m) => m.day.notDelivered)}</td>
      <td className={`${td} text-right`}>{sum((m) => m.day.cancelled)}</td>
      <td className={`${td} text-right`}>{formatRupees(sum((m) => m.day.codPaise))}</td>
      <td className={`${td} text-right`}>{formatRupees(sum((m) => m.due.paise))}</td>
      <td />
    </tr>
  )
}
