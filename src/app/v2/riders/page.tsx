import { requireRole } from '@/lib/session'
import { opsDayCaption, opsDayOf } from '@/lib/opsDay'
import { PING_INTERVAL_SECONDS } from '@/lib/riderLocation'
import { formatServiceDate } from '@/lib/format'
import { loadCashReceiver, loadOutletChoices, loadRiderRoster, loadTeamLeads, readOpsDay } from '@/lib/v2/riders'
import { PageHeader } from '@/components/v2/Table'
import { ButtonLink } from '@/components/v2/ui'
import { RiderBoard } from '@/components/v2/RiderBoard'
import { DayPicker } from '@/components/v2/DayPicker'

export const metadata = { title: 'Riders · RailServe' }

// Positions are never the same twice; there is nothing here to prerender.
export const dynamic = 'force-dynamic'

/**
 * Where every rider is, right now, and what the day has been. Renders once
 * on the server so the page arrives with real content; from then on the
 * board polls on its own (see RiderBoard). A store manager sees the riders
 * at their outlets and that outlets' work; an admin sees everyone.
 */
export default async function V2RidersPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireRole('ADMIN', 'STORE_MANAGER')
  const sp = await props.searchParams
  const today = opsDayOf()
  const day = readOpsDay(sp.date, today)
  const isAdmin = ctx.role === 'ADMIN'

  const [roster, mayReceive, outlets, teamLeads] = await Promise.all([
    loadRiderRoster(ctx, { serviceDate: day }),
    loadCashReceiver(ctx),
    loadOutletChoices(ctx),
    loadTeamLeads(ctx),
  ])

  return (
    <div className="grid gap-[18px]">
      <PageHeader
        title="Riders"
        note={
          roster.isToday
            ? `${formatServiceDate(day)} · ${opsDayCaption(day)} · positions arrive every ${PING_INTERVAL_SECONDS}s while the rider app is open`
            : `${formatServiceDate(day)} · ${opsDayCaption(day)} · a past day: figures only, nothing is in anyone's hands`
        }
        actions={
          <>
            <DayPicker value={day} today={today} param="date" max={today} label="Reporting day, 3am to 3am" />
            {isAdmin ? <ButtonLink href="/v2/riders/teams">Teams</ButtonLink> : null}
          </>
        }
      />
      {/* Keyed by day: a new key starts a fresh board rather than showing
          yesterday's riders under today's date. */}
      <RiderBoard key={day} initial={roster} mayReceive={mayReceive} isAdmin={isAdmin} outlets={outlets} teamLeads={teamLeads} />
    </div>
  )
}
