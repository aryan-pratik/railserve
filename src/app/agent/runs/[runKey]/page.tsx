import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/session'
import { findRun } from '@/lib/repo/runRepo'
import { formatMoney, formatServiceDate, formatTimeIST } from '@/lib/format'
import { Card, EmptyState, StatusBadge, TypeBadge } from '@/components/ui'
import { AutoRefresh } from '@/components/AutoRefresh'
import { DispatchRunButton } from '../../AgentActions'

export const metadata = { title: 'Run · RailServe' }

export default async function AgentRunPage(props: PageProps<'/agent/runs/[runKey]'>) {
  const ctx = await requireRole('DELIVERY_AGENT')
  const { runKey } = await props.params
  const key = decodeURIComponent(runKey)

  const run = await findRun(ctx, key)
  if (!run) notFound()

  const ready = run.statusCounts.PREPARED ?? 0

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href="/agent" className="text-sm text-slate-600 underline-offset-2 hover:underline">
        ← All runs
      </Link>

      <Card className="p-4">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-2xl font-bold text-slate-900">{run.trainNo ?? 'No train no.'}</span>
          <span className="text-slate-600">{run.trainName}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 text-sm text-slate-600">
          <span>{run.stationCode}</span>
          <span className="font-semibold text-slate-900">
            Arrives {formatTimeIST(run.scheduledArrival)}
          </span>
          <span>{formatServiceDate(run.serviceDate)}</span>
        </div>
        {/* Platform is a Phase 4 field — the agent needs it, and guessing is
            worse than admitting it is not known yet. */}
        <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Platform not available yet · scheduled time, not live
        </div>
        <div className="mt-4">
          <DispatchRunButton runKey={run.key} readyCount={ready} />
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {run.orders.length} order{run.orders.length === 1 ? '' : 's'} · walking order
        </h2>
        <AutoRefresh seconds={20} />
      </div>

      {run.orders.length === 0 ? (
        <EmptyState title="Nothing on this run" note="Orders will appear as they are assigned." />
      ) : (
        <div className="space-y-2">
          {run.orders.map((o) => {
            const cod = o.paymentMode === 'COD'
            const deliverable = o.status === 'DISPATCHED'
            return (
              <Link key={String(o._id)} href={`/agent/orders/${String(o._id)}`} className="block">
                <Card className="p-4 transition hover:border-slate-400">
                  <div className="flex items-start gap-3">
                    {/* Coach is the thing the agent navigates by, so it leads. */}
                    <div className="w-16 shrink-0 text-center">
                      <div className="rounded-lg bg-slate-900 px-2 py-1.5 text-lg font-bold leading-none text-white">
                        {o.coach ?? '—'}
                      </div>
                      {o.berth ? (
                        <div className="mt-1 text-xs font-medium text-slate-600">
                          berth {o.berth}
                        </div>
                      ) : null}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold text-slate-900">{o.externalOrderId}</span>
                        <TypeBadge type={o.orderType} />
                        <StatusBadge status={o.status} />
                      </div>
                      <div className="mt-1 truncate text-sm text-slate-600">
                        {o.orderType === 'BULK'
                          ? `${o.pax} pax · ${o.handoverPoint ?? 'handover'}`
                          : (o.contactName ?? 'Passenger')}
                      </div>
                      <div className="mt-2">
                        <span
                          className={`rounded px-2 py-1 text-sm font-bold ${
                            cod ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {cod ? `COLLECT ${formatMoney(o.amountPaise)}` : 'PREPAID'}
                        </span>
                        {deliverable ? (
                          <span className="ml-2 text-xs font-medium text-slate-500">
                            tap to deliver →
                          </span>
                        ) : null}
                      </div>
                    </div>
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
