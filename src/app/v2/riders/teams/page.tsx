import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { User } from '@/lib/models'
import { teamView, type TeamMember } from '@/lib/repo/teamRepo'
import { opsDayCaption, opsDayOf } from '@/lib/opsDay'
import { formatIST, formatRupees, formatServiceDate } from '@/lib/format'
import { readOpsDay } from '@/lib/v2/riders'
import { ButtonLink, Card, Chip, Mono, cx, v2Focus } from '@/components/v2/ui'
import { EmptyState, PageHeader, Sub, Table, Td, Th, rowClass } from '@/components/v2/Table'
import { DayPicker } from '@/components/v2/DayPicker'
import { RiderTeamMover } from '@/components/v2/RiderTeamMover'

export const metadata = { title: 'Rider teams · RailServe' }
export const dynamic = 'force-dynamic'

/**
 * Rider teams: each team leader, the riders under them, and the day each has
 * had, from the same ledger and the same 3am-to-3am day the rider app shows.
 * A team leader is made on the rider's record (Edit rider, Team leader);
 * riders are placed under one here.
 */
export default async function V2TeamsPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireRole('ADMIN')
  const sp = await props.searchParams
  const today = opsDayOf()
  const day = readOpsDay(sp.date, today)

  await connectDb()
  const [leads, riders] = await Promise.all([
    User.find({ role: 'DELIVERY_AGENT', isTeamLead: true }).select('name active').sort({ active: -1, name: 1 }).lean(),
    User.find({ role: 'DELIVERY_AGENT', isTeamLead: { $ne: true }, active: true }).select('name teamLeadId').sort({ name: 1 }).lean(),
  ])
  const teams = await Promise.all(leads.map((l) => teamView(ctx, l._id, { day })))
  const leadName = new Map(leads.map((l) => [String(l._id), l.name]))

  return (
    <div className="grid gap-[18px]">
      <Link href="/v2/riders" className={cx('inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-v2-muted hover:text-v2-ink', v2Focus)}>
        <ArrowLeft size={16} strokeWidth={2} aria-hidden />
        Riders
      </Link>
      <PageHeader
        title="Rider teams"
        note={`${formatServiceDate(day)} · ${opsDayCaption(day)} · cash due is across all days`}
        actions={
          <>
            <DayPicker value={day} today={today} param="date" max={today} label="Reporting day, 3am to 3am" />
            <ButtonLink href="/v2/riders?add=1" variant="primary">
              Add rider
            </ButtonLink>
          </>
        }
      />

      {teams.length === 0 ? (
        <EmptyState
          title="No team leaders yet"
          note="Open a rider from the Riders page, choose Edit and tick Team leader. Then place riders under them here."
          action={<ButtonLink href="/v2/riders">Go to riders</ButtonLink>}
        />
      ) : (
        teams.map((t) => (
          <Card
            key={t.lead.id}
            title={
              <span className="inline-flex flex-wrap items-center gap-2">
                Team {t.lead.name}
                <span className="font-mono text-sm font-semibold text-v2-muted">{t.members.length - 1}</span>
                {t.lead.canReceiveCash ? <Chip tone="ok">Leader may receive cash</Chip> : <Chip tone="grey">Leader may not receive cash</Chip>}
              </span>
            }
            action={
              <ButtonLink href={`/v2/riders?edit=${t.lead.id}`} size="sm">
                Edit leader
              </ButtonLink>
            }
          >
            <div className="-mx-[18px] -mb-[18px] overflow-x-auto border-t border-v2-line">
              <Table className="min-w-[52rem]">
                <thead>
                  <tr>
                    <Th className="pl-[18px] first:rounded-none">Rider</Th>
                    <Th align="right">In hand</Th>
                    <Th align="right">Delivered</Th>
                    <Th align="right">Not delivered</Th>
                    <Th align="right">Cancelled</Th>
                    <Th align="right">COD collected</Th>
                    <Th align="right">COD due</Th>
                    <Th className="pr-[18px] last:rounded-none">Last handed in</Th>
                  </tr>
                </thead>
                <tbody>
                  {t.members.map((m) => (
                    <MemberRow key={m.id} m={m} />
                  ))}
                  <TotalRow members={t.members} />
                </tbody>
              </Table>
            </div>
          </Card>
        ))
      )}

      <Card title="Move riders between teams">
        <RiderTeamMover
          riders={riders.map((r) => ({ id: String(r._id), name: r.name, team: r.teamLeadId ? `team ${leadName.get(String(r.teamLeadId)) ?? 'unknown'}` : null }))}
          leads={leads.filter((l) => l.active !== false).map((l) => ({ id: String(l._id), name: l.name }))}
        />
      </Card>
    </div>
  )
}

function MemberRow({ m }: { m: TeamMember }) {
  return (
    <tr className={cx(rowClass(), !m.active && 'text-v2-faint')}>
      <Td className="pl-[18px]">
        <span className="inline-flex items-center gap-2">
          <Link href={`/v2/riders/${m.id}`} className={cx('font-bold text-v2-ink underline-offset-2 hover:underline', v2Focus)}>
            {m.name}
          </Link>
          {m.isLead ? <Chip tone="info">Lead</Chip> : null}
          {m.active ? null : <Chip tone="grey">Inactive</Chip>}
        </span>
      </Td>
      <Td align="right">
        <Mono>{m.now.inHand}</Mono>
        {m.now.stale > 0 ? <Sub>+{m.now.stale} old</Sub> : null}
      </Td>
      <Td align="right">
        <Mono className="text-v2-ok">{m.day.delivered}</Mono>
      </Td>
      <Td align="right">
        <Mono>{m.day.notDelivered}</Mono>
      </Td>
      <Td align="right">
        <Mono>{m.day.cancelled}</Mono>
      </Td>
      <Td align="right">
        <Mono>{formatRupees(m.day.codPaise)}</Mono>
        <Sub>{m.day.codOrders} COD</Sub>
      </Td>
      <Td align="right">
        <Mono className={cx('font-semibold', m.due.paise > 0 && 'text-v2-cod')}>{formatRupees(m.due.paise)}</Mono>
        <Sub>
          {m.due.orders} order{m.due.orders === 1 ? '' : 's'}
        </Sub>
      </Td>
      <Td className="pr-[18px] text-xs text-v2-muted">
        {m.lastCollection ? (
          <>
            <Mono>{formatRupees(m.lastCollection.paise)}</Mono> · <Mono>{formatIST(m.lastCollection.at)}</Mono>
            {m.lastCollection.receivedBy ? <Sub>to {m.lastCollection.receivedBy}</Sub> : null}
          </>
        ) : (
          'Never'
        )}
      </Td>
    </tr>
  )
}

function TotalRow({ members }: { members: TeamMember[] }) {
  const sum = (f: (m: TeamMember) => number) => members.reduce((a, m) => a + f(m), 0)
  return (
    <tr className="bg-v2-surface-2 font-bold">
      <Td className="pl-[18px]">Team total</Td>
      <Td align="right">
        <Mono>{sum((m) => m.now.inHand)}</Mono>
      </Td>
      <Td align="right">
        <Mono>{sum((m) => m.day.delivered)}</Mono>
      </Td>
      <Td align="right">
        <Mono>{sum((m) => m.day.notDelivered)}</Mono>
      </Td>
      <Td align="right">
        <Mono>{sum((m) => m.day.cancelled)}</Mono>
      </Td>
      <Td align="right">
        <Mono>{formatRupees(sum((m) => m.day.codPaise))}</Mono>
      </Td>
      <Td align="right">
        <Mono>{formatRupees(sum((m) => m.due.paise))}</Mono>
      </Td>
      <Td className="pr-[18px]" />
    </tr>
  )
}
