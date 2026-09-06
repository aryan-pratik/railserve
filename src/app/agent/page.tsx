import Link from 'next/link'
import { requireRole } from '@/lib/session'
import { findRuns } from '@/lib/repo/runRepo'
import { timingForOrders, timingFor, trainFeedHealth } from '@/lib/train/service'
import { todayIST, formatServiceDate } from '@/lib/format'
import { Card, EmptyState, PageHeader } from '@/components/ui'
import { AutoRefresh } from '@/components/AutoRefresh'
import { TrainTiming } from '@/components/TrainTiming'
import { TrainFeedNotice } from '@/components/TrainFeedNotice'
import { IconChevronRight } from '@/components/Icons'
import { isSimulatedProvider } from '@/lib/train'

export const metadata = { title: 'My runs · RailServe' }

export default async function AgentRunsPage() {
  const ctx = await requireRole('DELIVERY_AGENT')
  const today = todayIST()
  const [runs, feedHealth] = await Promise.all([findRuns(ctx, today), trainFeedHealth()])

  // One provider call per distinct train, not per order.
  const timings = await timingForOrders(runs.flatMap((r) => r.orders))

  return (
    <div className="space-y-4">
      <PageHeader title="My runs" note={formatServiceDate(today)} action={<AutoRefresh seconds={20} />} />

      <TrainFeedNotice simulated={isSimulatedProvider()} health={feedHealth} />

      {runs.length === 0 ? (
        <EmptyState
          title="No runs today"
          note="Trains with orders from your outlet appear here as the orders arrive. This screen refreshes itself."
        />
      ) : (
        <div className="space-y-3">
          {runs.map((run) => {
            const ready = run.statusCounts.PREPARED ?? 0
            const out = run.statusCounts.DISPATCHED ?? 0
            const cooking =
              (run.statusCounts.RECEIVED ?? 0) +
              (run.statusCounts.ACCEPTED ?? 0) +
              (run.statusCounts.KOT_PRINTED ?? 0)
            const timing = timingFor(run.orders[0], timings)

            return (
              <Link key={run.key} href={`/agent/runs/${encodeURIComponent(run.key)}`} className="block rounded-xl">
                <Card className="flex items-start gap-3 p-4 transition-colors hover:border-accent">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="font-mono text-lg font-bold tabular-nums text-ink">
                        {run.trainNo ?? 'No train no.'}
                      </span>
                      <span className="text-sm text-muted">{run.trainName}</span>
                    </div>

                    <div className="mt-2">
                      <TrainTiming timing={timing} />
                    </div>

                    <div className="mt-2 text-sm text-muted">
                      {run.stationCode} · {run.orders.length} order{run.orders.length === 1 ? '' : 's'}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {ready > 0 ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 ring-1 ring-inset ring-amber-200">
                          {ready} ready to go
                        </span>
                      ) : null}
                      {out > 0 ? (
                        <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-900 ring-1 ring-inset ring-orange-200">
                          {out} out for delivery
                        </span>
                      ) : null}
                      {cooking > 0 ? (
                        <span className="rounded-full bg-sunken px-2 py-0.5 text-xs font-medium text-muted ring-1 ring-inset ring-line">
                          {cooking} still in the kitchen
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <IconChevronRight size={18} className="mt-1 shrink-0 text-faint" aria-hidden />
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
