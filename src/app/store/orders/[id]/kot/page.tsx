import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/session'
import { findById } from '@/lib/repo/orderRepo'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'
import { KotTicket } from '@/components/KotTicket'
import { PrintButton } from './PrintButton'

export const metadata = { title: 'KOT · RailServe' }

export default async function KotPage(props: PageProps<'/store/orders/[id]/kot'>) {
  const ctx = await requireRole('STORE_MANAGER', 'ADMIN')
  const { id } = await props.params

  const order = await findById(ctx, id)
  if (!order) notFound()

  await connectDb()
  const outlet = order.restaurantId
    ? await Restaurant.findById(order.restaurantId).select('name stationName').lean()
    : null

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Link href={`/store/orders/${id}`} className="text-sm text-muted underline-offset-2 hover:underline">
          ← Back to order
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-xs text-faint">80mm thermal preview</span>
          <PrintButton />
        </div>
      </div>

      <div className="flex justify-center">
        <KotTicket order={order} outlet={outlet} />
      </div>
    </div>
  )
}
