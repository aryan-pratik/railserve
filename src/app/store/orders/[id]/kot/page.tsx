import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/session'
import { findById } from '@/lib/repo/orderRepo'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'
import { KotTickets } from '@/components/KotTicket'
import { dietLookupFor } from '@/lib/repo/menuRepo'
import { PrintButton } from './PrintButton'
import { BackLink } from '@/components/ui'

export const metadata = { title: 'KOT · RailServe' }

export default async function KotPage(props: PageProps<'/store/orders/[id]/kot'>) {
  const ctx = await requireRole('STORE_MANAGER', 'ADMIN')
  const { id } = await props.params

  const order = await findById(ctx, id)
  if (!order) notFound()

  await connectDb()
  const outlet = order.restaurantId
    ? await Restaurant.findOne({ _id: order.restaurantId, tenantId: ctx.tenantId }).select('name stationName').lean()
    : null

  const lookup = await dietLookupFor(ctx.tenantId, [order])

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <BackLink href={`/store/orders/${id}`}>Back to order</BackLink>
        <div className="flex items-center gap-3">
          <span className="text-xs text-faint">80mm thermal preview</span>
          <PrintButton printUrl={`/api/store/orders/${id}/kot`} />
        </div>
      </div>

      <div className="flex flex-col items-center gap-4">
        <KotTickets order={order} outlet={outlet} lookup={lookup} />
      </div>
    </div>
  )
}
