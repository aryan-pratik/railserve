import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/session'
import { findRun } from '@/lib/repo/runRepo'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'
import { KotTickets } from '@/components/KotTicket'
import { PrintButton } from '../../../orders/[id]/kot/PrintButton'
import { BackLink } from '@/components/ui'

export const metadata = { title: 'KOT batch · RailServe' }

/**
 * The KOTs for one train: the orders waiting for one (ACCEPTED) and the ones
 * in the kitchen now (KOT_PRINTED). An order not yet accepted, or already
 * cooked, has no KOT to show, so it is not on this page either.
 *
 * The Print button here is a reprint, so it covers only the KOT_PRINTED
 * orders; the board's "Print N KOTs" is what sends the ACCEPTED ones.
 */
export default async function RunKotPage(props: PageProps<'/store/runs/[runKey]/kot'>) {
  const ctx = await requireRole('STORE_MANAGER', 'ADMIN')
  const { runKey } = await props.params

  const run = await findRun(ctx, decodeURIComponent(runKey))
  const orders = (run?.orders ?? []).filter(
    (o) => o.status === 'ACCEPTED' || o.status === 'KOT_PRINTED',
  )
  if (!run || orders.length === 0) notFound()
  const reprintable = orders.filter((o) => o.status === 'KOT_PRINTED').length

  await connectDb()
  const outletIds = orders.map((o) => o.restaurantId).filter((id) => id != null)
  const outlets = await Restaurant.find({ _id: { $in: outletIds } })
    .select('name stationName')
    .lean()
  const outletById = new Map(outlets.map((o) => [String(o._id), o]))

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <BackLink href="/store">Back to the board</BackLink>
        <div className="flex items-center gap-3">
          <span className="text-xs text-faint">
            {orders.length} order{orders.length === 1 ? '' : 's'} ·{' '}
            {run.trainNo ?? 'no train no.'}
          </span>
          {reprintable > 0 ? (
            <PrintButton
              printUrl={`/api/store/runs/${encodeURIComponent(runKey)}/kot`}
              label={`Reprint ${reprintable}`}
            />
          ) : null}
        </div>
      </div>

      <div className="flex flex-col items-center gap-4">
        {orders.map((order) => (
          <KotTickets
            key={String(order._id)}
            order={order}
            outlet={outletById.get(String(order.restaurantId)) ?? null}
          />
        ))}
      </div>
    </div>
  )
}
