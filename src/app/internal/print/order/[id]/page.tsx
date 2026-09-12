import { notFound } from 'next/navigation'
import { findById } from '@/lib/repo/orderRepo'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'
import { KotTicket } from '@/components/KotTicket'
import { requireInternalRenderToken, INTERNAL_CTX } from '@/lib/printer/internalAuth'

export const dynamic = 'force-dynamic'

/** Nothing but the ticket — this is what the screenshot step captures. */
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
    <div className="flex justify-center bg-white p-4">
      <KotTicket order={order} outlet={outlet} />
    </div>
  )
}
