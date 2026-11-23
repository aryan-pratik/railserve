import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requirePermission } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'
import { todayIST } from '@/lib/format'
import { PageHeader } from '@/components/v2/Table'
import { OrderComposerV2 } from '@/components/v2/OrderComposerV2'

export const metadata = { title: 'New order · RailServe' }

export default async function V2NewOrderPage() {
  const ctx = await requirePermission('orders.create')
  await connectDb()
  // Only the outlets this person holds: the repository refuses the rest anyway.
  const outlets = await Restaurant.find(ctx.role === 'ADMIN' ? { tenantId: ctx.tenantId, active: true } : { _id: { $in: ctx.restaurantIds }, tenantId: ctx.tenantId, active: true })
    .select('name stationCode')
    .sort({ name: 1 })
    .lean()

  return (
    <div className="grid gap-[18px]">
      <div className="grid gap-2">
        <Link href={ctx.role === 'STORE_MANAGER' ? '/v2/kitchen' : '/v2/orders'} className="inline-flex w-fit items-center gap-1.5 text-[13px] font-semibold text-v2-muted hover:text-v2-ink">
          <ArrowLeft size={14} aria-hidden />
          {ctx.role === 'STORE_MANAGER' ? 'Kitchen' : 'Orders'}
        </Link>
        <PageHeader title="New order" note="Paste an aggregator message or a WhatsApp enquiry, or enter a phone order by hand." />
      </div>
      <OrderComposerV2
        outlets={outlets.map((o) => ({ id: String(o._id), label: `${o.name} · ${o.stationCode}` }))}
        today={todayIST()}
        canEnquire={ctx.role === 'ADMIN'}
      />
    </div>
  )
}
