import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/session'
import { findRun } from '@/lib/repo/runRepo'
import { formatMoney, formatServiceDate } from '@/lib/format'
import { timingForOrders, timingFor } from '@/lib/train/service'
import { computeDispatchAt } from '@/lib/train/policy'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'
import { env } from '@/lib/env'
import { TrainTiming } from '@/components/TrainTiming'
import { LeaveNowBanner } from '@/components/LeaveNowBanner'
import { BackLink, Card, EmptyState, StatusBadge, TypeBadge } from '@/components/ui'
import { AutoRefresh } from '@/components/AutoRefresh'
import { IconChevronRight } from '@/components/Icons'
import { DispatchRunButton } from '../../AgentActions'

export const metadata = { title: 'Run · RailServe' }

export default async function AgentRunPage(props: PageProps<'/agent/runs/[runKey]'>) {
  const ctx = await requireRole('DELIVERY_AGENT')
  const { runKey } = await props.params
  const key = decodeURIComponent(runKey)

  const run = await findRun(ctx, key)
  if (!run) notFound()

  const ready = run.statusCounts.PREPARED ?? 0

  await connectDb()
  const [timings, outlet] = await Promise.all([
    timingForOrders(run.orders),
    // Walk time is a property of the outlet, not the train.
    Restaurant.findById(run.orders[0]?.restaurantId).select('walkToPlatformMinutes').lean(),
  ])
  const timing = timingFor(run.orders[0], timings)

  const dispatchAt = computeDispatchAt({
    etaAt: timing.effectiveArrival,
    walkToPlatformMinutes: outlet?.walkToPlatformMinutes ?? 10,
    bufferMinutes: env.DISPATCH_BUFFER_MINUTES,
  })

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <BackLink href="/agent">All runs</BackLink>

      <Card className="p-4">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-mono text-2xl font-bold tabular-nums text-ink">{run.trainNo ?? 'No train no.'}</span>
          <span className="text-muted">{run.trainName}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 text-sm text-muted">
          <span>{run.stationCode}</span>
          <span>{formatServiceDate(run.serviceDate)}</span>
        </div>

        <div className="mt-2">
          <TrainTiming timing={timing} />
        </div>

        <div className="mt-4">
          <LeaveNowBanner
            dispatchAt={dispatchAt ? dispatchAt.toISOString() : null}
            platform={timing.platform}
            trainNo={run.trainNo}
            orderCount={ready}
            serverNow={new Date().toISOString()}
          />
        </div>

        <div className="mt-3">
          <DispatchRunButton runKey={run.key} readyCount={ready} />
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
          {run.orders.length} order{run.orders.length === 1 ? '' : 's'} in walking order
        </h2>
        <AutoRefresh seconds={20} />
      </div>

      {run.orders.length === 0 ? (
        <EmptyState title="Nothing on this run" note="Orders appear here as they arrive." />
      ) : (
        <div className="space-y-2">
          {run.orders.map((o) => {
            const cod = o.paymentMode === 'COD'
            const deliverable = o.status === 'DISPATCHED'
            return (
              <Link key={String(o._id)} href={`/agent/orders/${String(o._id)}`} className="block rounded-xl">
                <Card className="p-4 transition-colors hover:border-accent">
                  <div className="flex items-start gap-3">
                    {/* Coach is the thing the agent navigates by, so it leads. */}
                    <div className="w-16 shrink-0 text-center">
                      <div className="rounded-lg bg-ink px-2 py-1.5 font-mono text-lg font-bold leading-none tabular-nums text-white">
                        {o.coach ?? '?'}
                      </div>
                      {o.berth ? <div className="mt-1 text-xs font-medium tabular-nums text-muted">berth {o.berth}</div> : null}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-sm font-semibold text-ink">{o.externalOrderId}</span>
                        <TypeBadge type={o.orderType} />
                        <StatusBadge status={o.status} />
                      </div>
                      <div className="mt-1 truncate text-sm text-muted">
                        {o.orderType === 'BULK'
                          ? `${o.pax} pax · ${o.handoverPoint ?? 'handover'}`
                          : (o.contactName ?? 'Passenger')}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className={`rounded px-2 py-1 text-sm font-bold tabular-nums ${cod ? 'bg-amber-100 text-amber-900' : 'bg-sunken text-muted'}`}>
                          {cod ? `COLLECT ${formatMoney(o.amountPaise)}` : 'PREPAID'}
                        </span>
                        {deliverable ? <span className="text-xs font-medium text-emerald-700">Tap to deliver</span> : null}
                      </div>
                    </div>
                    <IconChevronRight size={18} className="mt-1 shrink-0 text-faint" aria-hidden />
                  </div>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
