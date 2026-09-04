import { requireRole } from '@/lib/session'
import { findMany } from '@/lib/repo/orderRepo'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'
import { shiftServiceDate, todayIST } from '@/lib/format'
import { OrdersTable } from '@/components/OrdersTable'
import { Button, Card, Field, PageHeader, inputClass } from '@/components/ui'

export const metadata = { title: 'History · RailServe' }

/**
 * Lookup, not live work.
 *
 * The board deliberately shows only what is still moving, so a delivered order
 * disappears from it the moment it lands. This is where it goes to be found
 * again — a passenger calls back, a payment is queried, a day gets reconciled.
 */
export default async function StoreHistoryPage(props: PageProps<'/store/history'>) {
  const ctx = await requireRole('STORE_MANAGER', 'ADMIN')
  const sp = await props.searchParams

  const to = typeof sp.to === 'string' && sp.to ? sp.to : todayIST()
  const from = typeof sp.from === 'string' && sp.from ? sp.from : shiftServiceDate(to, -7)
  const q = typeof sp.q === 'string' ? sp.q.trim() : ''

  const filter: Record<string, unknown> = { serviceDate: { $gte: from, $lte: to } }
  if (q) {
    // Order id or train number — the two things anyone actually has to hand.
    filter.$or = [
      { externalOrderId: { $regex: q, $options: 'i' } },
      { trainNo: { $regex: q, $options: 'i' } },
      { contactPhone: { $regex: q, $options: 'i' } },
    ]
  }

  const orders = await findMany(ctx, filter, { sort: { serviceDate: -1, createdAt: -1 } })

  await connectDb()
  const multiOutlet = ctx.restaurantIds.length > 1 || ctx.role === 'ADMIN'
  const outlets = multiOutlet
    ? await Restaurant.find({}).select('name').lean()
    : []
  const outletName = new Map(outlets.map((o) => [String(o._id), o.name]))

  return (
    <div className="space-y-4">
      <PageHeader title="History" note={`${orders.length} order${orders.length === 1 ? '' : 's'} from ${from} to ${to}`} />

      <Card>
        <form className="grid gap-3 p-4 sm:grid-cols-4">
          <Field label="From" htmlFor="from">
            <input id="from" name="from" type="date" defaultValue={from} className={inputClass} />
          </Field>
          <Field label="To" htmlFor="to">
            <input id="to" name="to" type="date" defaultValue={to} className={inputClass} />
          </Field>
          <Field label="Search" htmlFor="q" hint="Order id, train number or phone.">
            <input id="q" name="q" defaultValue={q} placeholder="12561" className={inputClass} />
          </Field>
          <div className="flex items-end">
            <Button type="submit" variant="secondary" className="w-full">Apply</Button>
          </div>
        </form>
      </Card>

      <OrdersTable
        orders={orders.map((o) => ({
          id: String(o._id),
          externalOrderId: o.externalOrderId,
          orderType: o.orderType,
          status: o.status,
          serviceDate: o.serviceDate,
          trainNo: o.trainNo,
          coach: o.coach,
          berth: o.berth,
          contactName: o.contactName,
          scheduledArrival: o.scheduledArrival,
          amountPaise: o.amountPaise,
          outletName: outletName.get(String(o.restaurantId)) ?? null,
          remark: o.remark,
        }))}
        hrefFor={(id) => `/store/orders/${id}`}
        showOutlet={multiOutlet}
        emptyNote="Nothing in this date range. Widen the dates or clear the search."
      />
    </div>
  )
}
