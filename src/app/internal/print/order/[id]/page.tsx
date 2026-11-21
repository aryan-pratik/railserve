import { notFound } from 'next/navigation'
import { findById } from '@/lib/repo/orderRepo'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'
import { KotTickets } from '@/components/KotTicket'
import { dietLookupFor } from '@/lib/repo/menuRepo'
import { requireInternalRenderToken, internalCtx } from '@/lib/printer/internalAuth'

export const dynamic = 'force-dynamic'

/** Nothing but the order's tickets — this is what the screenshot step captures. */
export default async function InternalPrintOrderPage(props: PageProps<'/internal/print/order/[id]'>) {
  await requireInternalRenderToken()
  const { id } = await props.params
  // The print queue puts the tenant on the URL (`?t=`); see printer/queue.ts.
  const ctx = internalCtx((await props.searchParams).t)

  const order = await findById(ctx, id)
  if (!order) notFound()

  await connectDb()
  const outlet = order.restaurantId
    ? await Restaurant.findOne({ _id: order.restaurantId, tenantId: ctx.tenantId }).select('name stationName').lean()
    : null

  const lookup = await dietLookupFor(ctx.tenantId, [order])

  return (
    <div className="flex flex-col items-center gap-4 bg-white p-4">
      <KotTickets order={order} outlet={outlet} lookup={lookup} />
    </div>
  )
}
