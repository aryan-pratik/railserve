import { requirePage, requirePermission } from '@/lib/session'
import { opsDayCaption, opsDayOf } from '@/lib/opsDay'
import { PING_INTERVAL_SECONDS } from '@/lib/riderLocation'
import { formatRupees, formatServiceDate } from '@/lib/format'
import { cashHeldBy } from '@/lib/repo/riderCashRepo'
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
  const ctx = await requirePermission('riders.manage')
  await requirePage('riders')
  const sp = await props.searchParams
  const today = opsDayOf()
  const day = readOpsDay(sp.date, today)
  const isAdmin = ctx.role === 'ADMIN'

  const [roster, mayReceive, outlets, teamLeads, heldByMe] = await Promise.all([
    loadRiderRoster(ctx, { serviceDate: day }),
    loadCashReceiver(ctx),
    loadOutletChoices(ctx),
    loadTeamLeads(ctx),
    // The cash this manager took from riders and has not yet given the owner.
    isAdmin ? Promise.resolve(0) : cashHeldBy(ctx),
  ])

  return (
    <div className="grid gap-[18px]">
      <PageHeader
        title={isAdmin ? 'Riders' : 'Riders and cash'}
        note={
          roster.isToday
            ? `${formatServiceDate(day)} · ${opsDayCaption(day)} · positions arrive every ${PING_INTERVAL_SECONDS}s while the rider app is open`
            : `${formatServiceDate(day)} · ${opsDayCaption(day)} · a past day: what riders finished then, and what is still unpaid from it`
        }
        actions={
          <>
            <DayPicker value={day} today={today} param="date" max={today} label="Reporting day, 3am to 3am" />
            {heldByMe > 0 ? (
              <span className="rounded-full border border-v2-line bg-v2-surface px-3.5 py-1.5 text-[13px] font-semibold" title="Cash you took from riders that the owner has not yet marked as received from you.">
                With you: <span className="font-mono tabular-nums">{formatRupees(heldByMe)}</span>
              </span>
            ) : null}
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
