import { notFound } from 'next/navigation'
import { findRun } from '@/lib/repo/runRepo'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'
import { KotTicket } from '@/components/KotTicket'
import { requireInternalRenderToken, INTERNAL_CTX } from '@/lib/printer/internalAuth'

export const dynamic = 'force-dynamic'

export default async function InternalPrintRunPage(props: PageProps<'/internal/print/run/[runKey]'>) {
  await requireInternalRenderToken()
  const { runKey } = await props.params

  const run = await findRun(INTERNAL_CTX, decodeURIComponent(runKey))
  if (!run || run.orders.length === 0) notFound()

  await connectDb()
  const outletIds = run.orders.map((o) => o.restaurantId).filter((id) => id != null)
  const outlets = await Restaurant.find({ _id: { $in: outletIds } })
    .select('name stationName')
    .lean()
  const outletById = new Map(outlets.map((o) => [String(o._id), o]))

  return (
    <div className="flex flex-col items-center gap-4 bg-white p-4">
      {run.orders.map((order) => (
        <KotTicket
          key={String(order._id)}
          order={order}
          outlet={outletById.get(String(order.restaurantId)) ?? null}
        />
      ))}
    </div>
  )
}
