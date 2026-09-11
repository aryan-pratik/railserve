import { requireRole } from '@/lib/session'
import { findMany } from '@/lib/repo/orderRepo'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'
import { formatDateRange, shiftServiceDate, todayIST } from '@/lib/format'
import { OrdersTable } from '@/components/OrdersTable'
import { QueryForm } from '@/components/QueryForm'
import { Button, Card, Field, PageHeader, inputClass } from '@/components/ui'

export const metadata = { title: 'Order history · RailServe' }

/**
 * Lookup, not live work.
 *
 * The board shows only what is still moving, so a delivered order disappears
 * from it the moment it lands. This is where it goes to be found again.
 */
export default async function StoreHistoryPage(props: PageProps<'/store/history'>) {
  const ctx = await requireRole('STORE_MANAGER', 'ADMIN')
  const sp = await props.searchParams

  const to = typeof sp.to === 'string' && sp.to ? sp.to : todayIST()
  const from = typeof sp.from === 'string' && sp.from ? sp.from : shiftServiceDate(to, -7)
  const q = typeof sp.q === 'string' ? sp.q.trim() : ''

  const filter: Record<string, unknown> = { serviceDate: { $gte: from, $lte: to } }
  if (q) {
    // Order id, train number or phone: the things anyone actually has to hand.
    filter.$or = [
      { externalOrderId: { $regex: q, $options: 'i' } },
      { trainNo: { $regex: q, $options: 'i' } },
      { contactPhone: { $regex: q, $options: 'i' } },
    ]
  }

  await connectDb()
  const multiOutlet = ctx.restaurantIds.length > 1 || ctx.role === 'ADMIN'
  const [orders, outlets] = await Promise.all([
    findMany(ctx, filter, { sort: { serviceDate: -1, createdAt: -1 } }),
    multiOutlet ? Restaurant.find({}).select('name').lean() : Promise.resolve([]),
  ])
  const outletName = new Map(outlets.map((o) => [String(o._id), o.name]))

  return (
    <div className="space-y-4">
      <PageHeader
        title="Order history"
        note={`${orders.length} order${orders.length === 1 ? '' : 's'}, ${formatDateRange(from, to)}`}
      />

      <Card>
        <QueryForm action="/store/history" className="grid items-end gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="From" htmlFor="from">
            <input id="from" name="from" type="date" defaultValue={from} className={inputClass} />
          </Field>
          <Field label="To" htmlFor="to">
            <input id="to" name="to" type="date" defaultValue={to} className={inputClass} />
          </Field>
          <Field label="Search" htmlFor="q">
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={q}
              placeholder="Order id, train number or phone"
              autoComplete="off"
              spellCheck={false}
              className={inputClass}
            />
          </Field>
          <Button type="submit" variant="secondary">Apply</Button>
        </QueryForm>
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
          rawSeat: o.rawSeat,
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
