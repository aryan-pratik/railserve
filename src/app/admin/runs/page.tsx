import Link from 'next/link'
import { requireRole } from '@/lib/session'
import { findRuns } from '@/lib/repo/runRepo'
import { connectDb } from '@/lib/db'
import { User } from '@/lib/models'
import { formatServiceDate, formatTimeIST, todayIST } from '@/lib/format'
import { Card, EmptyState, StatusBadge, inputClass } from '@/components/ui'
import { AssignRunForm } from './AssignRunForm'

export const metadata = { title: 'Runs · RailServe' }

export default async function RunsPage(props: PageProps<'/admin/runs'>) {
  const ctx = await requireRole('ADMIN')
  const sp = await props.searchParams
  const dateParam = Array.isArray(sp.date) ? sp.date[0] : sp.date
  const serviceDate = dateParam || todayIST()

  const [runs, agents] = await Promise.all([
    findRuns(ctx, serviceDate),
    connectDb().then(() =>
      User.find({ role: 'DELIVERY_AGENT', active: true }).select('name').sort({ name: 1 }).lean(),
    ),
  ])

  const agentList = agents.map((a) => ({ id: String(a._id), name: a.name }))

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Runs</h1>
          <p className="mt-1 text-sm text-slate-600">
            Orders grouped by train, date and station — the unit of dispatch.
          </p>
        </div>
        <form method="get" className="flex items-end gap-2">
          <div>
            <label htmlFor="date" className="mb-1 block text-xs font-medium text-slate-600">
              Service date
            </label>
            <input id="date" type="date" name="date" defaultValue={serviceDate} className={inputClass} />
          </div>
          <button type="submit"
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">
            Show
          </button>
        </form>
      </div>

      <p className="text-sm text-slate-500">{formatServiceDate(serviceDate)}</p>

      {runs.length === 0 ? (
        <EmptyState
          title="No runs on this date"
          note="A run appears once there is at least one live order for a train at a station."
        />
      ) : (
        <div className="space-y-4">
          {runs.map((run) => {
            // Every order on a run carries the same agents in practice; show the
            // first order's assignment as the run's, which is what assigning writes.
            const assigned = run.orders[0]
              ? run.orders[0].delivery.agentIds.map(String)
              : []
            const mixed = run.orders.some(
              (o) => o.delivery.agentIds.map(String).join(',') !== assigned.join(','),
            )

            return (
              <Card key={run.key}>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-slate-200 px-4 py-3">
                  <span className="text-lg font-bold text-slate-900">
                    {run.trainNo ?? 'No train no.'}
                  </span>
                  <span className="text-sm text-slate-600">{run.trainName}</span>
                  <span className="text-sm text-slate-500">{run.stationCode}</span>
                  <span className="ml-auto text-sm font-semibold tabular-nums">
                    {formatTimeIST(run.scheduledArrival)}
                  </span>
                </div>

                <div className="divide-y divide-slate-100">
                  {run.orders.map((o) => (
                    <div key={String(o._id)} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                      <span className="w-12 rounded bg-slate-100 px-2 py-0.5 text-center font-bold">
                        {o.coach ?? '—'}
                      </span>
                      <Link href={`/admin/orders/${String(o._id)}`}
                        className="font-medium text-slate-900 underline-offset-2 hover:underline">
                        {o.externalOrderId}
                      </Link>
                      <StatusBadge status={o.status} />
                      <span className="ml-auto text-xs text-slate-500">
                        {o.orderType === 'BULK' ? `${o.pax} pax` : (o.rawSeat ?? '')}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="border-t border-slate-200 bg-slate-50 px-4 py-3">
                  {mixed ? (
                    <p className="mb-2 text-xs font-medium text-amber-700">
                      Orders on this run currently have different agents. Assigning here will
                      set them all to the same.
                    </p>
                  ) : null}
                  <AssignRunForm runKey={run.key} agents={agentList} assigned={assigned} />
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
