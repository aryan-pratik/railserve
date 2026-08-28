import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/session'
import { findRun } from '@/lib/repo/runRepo'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'
import { KotTicket } from '@/components/KotTicket'
import { PrintButton } from '../../../orders/[id]/kot/PrintButton'

export const metadata = { title: 'KOT batch · RailServe' }

/**
 * Every ticket for one train, as a single print job.
 *
 * The chef still gets one docket per order — one bag, one ticket — but the
 * manager prints the whole train once. globals.css breaks the page between
 * tickets so the printer cuts in the right places.
 */
export default async function RunKotPage(props: PageProps<'/store/runs/[runKey]/kot'>) {
  const ctx = await requireRole('STORE_MANAGER', 'ADMIN')
  const { runKey } = await props.params

  const run = await findRun(ctx, decodeURIComponent(runKey))
  if (!run || run.orders.length === 0) notFound()

  await connectDb()
  const outletIds = run.orders.map((o) => o.restaurantId).filter((id) => id != null)
  const outlets = await Restaurant.find({ _id: { $in: outletIds } })
    .select('name stationName')
    .lean()
  const outletById = new Map(outlets.map((o) => [String(o._id), o]))

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Link href="/store" className="text-sm text-muted underline-offset-2 hover:underline">
          ← Back to the board
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-xs text-faint">
            {run.orders.length} ticket{run.orders.length === 1 ? '' : 's'} ·{' '}
            {run.trainNo ?? 'no train no.'}
          </span>
          <PrintButton />
        </div>
      </div>

      <div className="flex flex-col items-center gap-4">
        {run.orders.map((order) => (
          <KotTicket
            key={String(order._id)}
            order={order}
            outlet={outletById.get(String(order.restaurantId)) ?? null}
          />
        ))}
      </div>
    </div>
  )
}
