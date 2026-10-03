import { notFound } from 'next/navigation'
import { findById } from '@/lib/repo/orderRepo'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'
import { KotTickets } from '@/components/KotTicket'
import { requireInternalRenderToken, INTERNAL_CTX } from '@/lib/printer/internalAuth'

export const dynamic = 'force-dynamic'

/** Nothing but the order's tickets — this is what the screenshot step captures. */
export default async function InternalPrintOrderPage(props: PageProps<'/internal/print/order/[id]'>) {
  await requireInternalRenderToken()
  const { id } = await props.params

  const order = await findById(INTERNAL_CTX, id)
  if (!order) notFound()

  await connectDb()
  const outlet = order.restaurantId
    ? await Restaurant.findById(order.restaurantId).select('name stationName').lean()
    : null

  return (
    <div className="flex flex-col items-center gap-4 bg-white p-4">
      <KotTickets order={order} outlet={outlet} />
    </div>
  )
}
