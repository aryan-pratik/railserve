import { requireRole } from '@/lib/session'
import { countOrders, findMany } from '@/lib/repo/orderRepo'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'
import { formatDateRange, shiftServiceDate, todayIST } from '@/lib/format'
import { callNoteRow } from '@/lib/orderView'
import { OrdersTable } from '@/components/OrdersTable'
import { QueryForm } from '@/components/QueryForm'
import { Button, Card, Field, PageHeader, Pagination, inputClass } from '@/components/ui'
import { readPage, withPage } from '@/lib/pagination'
import { NO_RIDER, riderClause, riderNamesFor, riderOptions } from '@/lib/repo/riderFilter'

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
  const rider = typeof sp.rider === 'string' ? sp.rider : ''
  const { page, pageSize, skip } = readPage(sp)

  const filter: Record<string, unknown> = { serviceDate: { $gte: from, $lte: to } }
  if (q) {
    // Order id, train number or phone: the things anyone actually has to hand.
    // Escaped, so a typed "(" or "+" is matched literally rather than failing
    // the whole page as an invalid regex.
    const rx = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' }
    filter.$or = [{ externalOrderId: rx }, { trainNo: rx }, { contactPhone: rx }]
  }
  const byRider = riderClause(rider)
  if (byRider) Object.assign(filter, byRider)

  await connectDb()
  const multiOutlet = ctx.restaurantIds.length > 1 || ctx.role === 'ADMIN'
  // Paged, not capped: findMany used to stop at its default 200 silently, and
  // the header then reported 200 as if it were the whole range.
  const [orders, total, outlets, riders] = await Promise.all([
    findMany(ctx, filter, { sort: { serviceDate: -1, createdAt: -1 }, limit: pageSize, skip }),
    countOrders(ctx, filter),
    multiOutlet ? Restaurant.find({}).select('name').lean() : Promise.resolve([]),
    riderOptions(ctx),
  ])
  const riderName = await riderNamesFor(orders)
  const outletName = new Map(outlets.map((o) => [String(o._id), o.name]))

  return (
    <div className="space-y-4">
      <PageHeader
        title="Order history"
        note={`${total} order${total === 1 ? '' : 's'}, ${formatDateRange(from, to)}`}
      />

      <Card>
        <QueryForm action="/store/history" className="grid items-end gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
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
          <Field label="Rider" htmlFor="rider">
            <select id="rider" name="rider" defaultValue={byRider ? rider : ''} className={inputClass}>
              <option value="">Any rider</option>
              <option value={NO_RIDER}>No rider yet</option>
              {riders.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}{r.active ? '' : ' (inactive)'}
                </option>
              ))}
            </select>
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
          rider: riderName.get(String(o._id)),
          ...callNoteRow(o),
        }))}
        hrefFor={(id) => `/store/orders/${id}`}
        showOutlet={multiOutlet}
        showRider
        emptyNote="Nothing in this date range. Widen the dates or clear the search and rider."
      />

      {total > 0 ? (
        <div className="rounded-xl border border-line bg-surface">
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            buildHref={(target) => {
              const u = new URLSearchParams()
              if (sp.from) u.set('from', from)
              if (sp.to) u.set('to', to)
              if (q) u.set('q', q)
              if (byRider) u.set('rider', rider)
              const s = withPage(u, target).toString()
              return s ? `/store/history?${s}` : '/store/history'
            }}
          />
        </div>
      ) : null}
    </div>
  )
}
