import { notFound } from 'next/navigation'
import { findRun } from '@/lib/repo/runRepo'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'
import { KotTickets } from '@/components/KotTicket'
import { dietLookupFor } from '@/lib/repo/menuRepo'
import { requireInternalRenderToken, internalCtx } from '@/lib/printer/internalAuth'

export const dynamic = 'force-dynamic'

export default async function InternalPrintRunPage(props: PageProps<'/internal/print/run/[runKey]'>) {
  await requireInternalRenderToken()
  const { runKey } = await props.params
  // The print queue puts the tenant on the URL (`?t=`); see printer/queue.ts.
  const ctx = internalCtx((await props.searchParams).t)
  const { orders: orderFilter } = await props.searchParams

  const run = await findRun(ctx, decodeURIComponent(runKey))
  if (!run) notFound()

  // ctx is ADMIN-shaped and bypasses every outlet scope, so this run
  // holds every brand trading at the station. The enqueue step passes the
  // exact ids it is entitled to print, and checks the tickets that come back
  // against them (checkRunRender in printer/queue.ts): each ticket names its
  // order, so a mismatch means the two disagree.
  const wanted = typeof orderFilter === 'string' ? new Set(orderFilter.split(',')) : null
  const printable = wanted ? run.orders.filter((o) => wanted.has(String(o._id))) : run.orders
  if (printable.length === 0) notFound()

  await connectDb()
  const outletIds = printable.map((o) => o.restaurantId).filter((id) => id != null)
  const outlets = await Restaurant.find({ _id: { $in: outletIds }, tenantId: ctx.tenantId })
    .select('name stationName')
    .lean()
  const outletById = new Map(outlets.map((o) => [String(o._id), o]))

  const lookup = await dietLookupFor(ctx.tenantId, printable)

  return (
    <div className="flex flex-col items-center gap-4 bg-white p-4">
      {printable.map((order) => (
        <KotTickets
          key={String(order._id)}
          order={order}
          outlet={outletById.get(String(order.restaurantId)) ?? null}
          lookup={lookup}
        />
      ))}
    </div>
  )
}
