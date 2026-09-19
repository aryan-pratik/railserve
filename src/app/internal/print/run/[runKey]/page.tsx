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
  const { orders: orderFilter } = await props.searchParams

  const run = await findRun(INTERNAL_CTX, decodeURIComponent(runKey))
  if (!run) notFound()

  // INTERNAL_CTX is ADMIN-shaped and bypasses every outlet scope, so this run
  // holds every brand trading at the station. The enqueue step passes the
  // exact ids it is entitled to print, and one ticket per id is what makes
  // `images.length === orderIds.length` a real invariant rather than a
  // coincidence that held only while one brand had orders.
  const wanted = typeof orderFilter === 'string' ? new Set(orderFilter.split(',')) : null
  const printable = wanted ? run.orders.filter((o) => wanted.has(String(o._id))) : run.orders
  if (printable.length === 0) notFound()

  await connectDb()
  const outletIds = printable.map((o) => o.restaurantId).filter((id) => id != null)
  const outlets = await Restaurant.find({ _id: { $in: outletIds } })
    .select('name stationName')
    .lean()
  const outletById = new Map(outlets.map((o) => [String(o._id), o]))

  return (
    <div className="flex flex-col items-center gap-4 bg-white p-4">
      {printable.map((order) => (
        <KotTicket
          key={String(order._id)}
          order={order}
          outlet={outletById.get(String(order.restaurantId)) ?? null}
        />
      ))}
    </div>
  )
}
