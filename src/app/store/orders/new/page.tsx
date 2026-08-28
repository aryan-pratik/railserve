import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'
import { todayIST } from '@/lib/format'
import { OrderComposer } from '@/components/OrderComposer'
import { PageHeader, ButtonLink } from '@/components/ui'
import { createOrderAction, pasteOrderAction } from '@/app/actions/orders'

export const metadata = { title: 'New order · RailServe' }

export default async function StoreNewOrderPage() {
  const ctx = await requireRole('STORE_MANAGER', 'ADMIN')

  await connectDb()
  // Only the outlets this manager actually holds — the repository would refuse
  // anything else anyway, so offering it in the dropdown is just a dead end.
  const outlets = await Restaurant.find(
    ctx.role === 'ADMIN' ? { active: true } : { _id: { $in: ctx.restaurantIds }, active: true },
  )
    .select('name stationCode')
    .sort({ name: 1 })
    .lean()

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title="New order"
        note="Paste an aggregator message, or enter a phone order by hand."
        action={<ButtonLink href="/store">Back to board</ButtonLink>}
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
