import Link from 'next/link'
import { requireRole } from '@/lib/session'
import { findRuns } from '@/lib/repo/runRepo'
import { todayIST, formatServiceDate, formatTimeIST } from '@/lib/format'
import { Card, EmptyState } from '@/components/ui'
import { AutoRefresh } from '@/components/AutoRefresh'

export const metadata = { title: 'My runs · RailServe' }

export default async function AgentRunsPage() {
  const ctx = await requireRole('DELIVERY_AGENT')
  const today = todayIST()
  const runs = await findRuns(ctx, today)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">My runs</h1>
          <p className="mt-1 text-sm text-slate-600">{formatServiceDate(today)}</p>
        </div>
        <AutoRefresh seconds={20} />
      </div>

      {runs.length === 0 ? (
        <EmptyState
          title="No runs assigned today"
          note="Runs appear here once an admin assigns you to orders. Pull down or wait — this refreshes itself."
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

            return (
              <Link key={run.key} href={`/agent/runs/${encodeURIComponent(run.key)}`} className="block">
                <Card className="p-4 transition hover:border-slate-400">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="text-lg font-bold text-slate-900">
                      {run.trainNo ?? 'No train no.'}
                    </span>
                    <span className="text-sm text-slate-600">{run.trainName}</span>
                    <span className="ml-auto text-sm font-semibold tabular-nums text-slate-900">
                      {formatTimeIST(run.scheduledArrival)}
                    </span>
                  </div>

                  <div className="mt-1 text-sm text-slate-500">
                    {run.stationCode} · {run.orders.length} order
                    {run.orders.length === 1 ? '' : 's'}
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
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                        {cooking} still in the kitchen
                      </span>
                    ) : null}
                  </div>
                </Card>
              </Link>
            )
          })}
        </div>
      )}

      <p className="text-xs text-slate-400">
        Times are scheduled, not live. Live train tracking arrives in a later phase.
      </p>
    </div>
  )
}
