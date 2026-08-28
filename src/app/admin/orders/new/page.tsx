import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'
import { todayIST } from '@/lib/format'
import { OrderComposer } from '@/components/OrderComposer'
import { PageHeader, ButtonLink } from '@/components/ui'
import { createOrderAction, pasteOrderAction } from '@/app/actions/orders'

export const metadata = { title: 'New order · RailServe' }

export default async function AdminNewOrderPage() {
  await requireRole('ADMIN')

  await connectDb()
  const outlets = await Restaurant.find({ active: true })
    .select('name stationCode')
    .sort({ name: 1 })
    .lean()

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title="New order"
        note="Paste an aggregator message, or enter a phone order by hand."
        action={<ButtonLink href="/admin">Back to board</ButtonLink>}
      />
      <OrderComposer
        outlets={outlets.map((o) => ({ id: String(o._id), label: `${o.name} · ${o.stationCode}` }))}
        today={todayIST()}
        pasteAction={pasteOrderAction}
        createAction={createOrderAction}
      />
    </div>
  )
}
