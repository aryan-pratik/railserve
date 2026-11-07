import { requireRole } from '@/lib/session'
import { countByPaymentMode, countOrders, distinctStatuses, findMany } from '@/lib/repo/orderRepo'
import { connectDb } from '@/lib/db'
import { Restaurant, Station } from '@/lib/models'
import { ORDER_STATUSES } from '@/lib/orderStatus'
import { ORDER_TYPES, ORDER_TYPE_LABEL } from '@/lib/orderEnums'
import { callNoteRow } from '@/lib/orderView'
import { AdminOrdersTable } from './AdminOrdersTable'
import { IconDownload, IconPlus, IconSearch } from '@/components/Icons'
import {
  Button, ButtonAnchor, ButtonLink, Card, Field, PageHeader, Pagination, Tabs,
  PAGE_SIZE_OPTIONS, inputClass, statusLabel,
} from '@/components/ui'
import { DateFilter } from '@/components/DateFilter'
import { StationMultiSelect } from '@/components/StationMultiSelect'
import { QueryForm } from '@/components/QueryForm'
import { resolveDateRange, type DateFilterMode } from '@/lib/dateFilter'
import { NO_RIDER, riderClause, riderNamesFor, riderOptions } from '@/lib/repo/riderFilter'
import { orderSearchClause, parseStations } from '@/lib/repo/orderSearch'
import type { QueryFilter } from 'mongoose'

/**
 * The payment modes an order can carry, in the order they are worth scanning.
 * Mirrors the PAYMENT_MODES union on the order model.
 */
const PAYMENT_TABS = [
  { value: '', label: 'All' },
  { value: 'COD', label: 'COD' },
  { value: 'PREPAID', label: 'Prepaid' },
  { value: 'INVOICE', label: 'Invoice' },
] as const

export const metadata = { title: 'All orders · RailServe' }

const DEFAULT_PAGE_SIZE = 20

/**
 * Lookup across every outlet.
 *
 * The board is where live work happens; this is where an order is found again
 * once it has left the board: a query, a refund, a reconciliation.
 */
export default async function AdminOrdersPage(props: PageProps<'/admin/orders'>) {
  const ctx = await requireRole('ADMIN')
  const sp = await props.searchParams

  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''
  const many = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : [])
  const outlet = one(sp.outlet)
  const stations = parseStations(many(sp.station))
  const status = one(sp.status)
  // Opens on today, like every other dated screen; "All time" is one click.
  const mode = (one(sp.mode) || 'today') as DateFilterMode
  const month = one(sp.month)
  const rawFrom = one(sp.from)
  const rawTo = one(sp.to)
  const { from: dateFrom, to: dateTo } = resolveDateRange(mode, { month, from: rawFrom, to: rawTo })
  const train = one(sp.train)
  // Unknown values are dropped, so a stale link cannot filter to nothing.
  const type = (ORDER_TYPES as readonly string[]).includes(one(sp.type)) ? one(sp.type) : ''
  // One box that searches everything. `orderId` is what the box used to be
  // called, so links bookmarked before then still find their order.
  const q = (one(sp.q) || one(sp.orderId)).trim()
  const payment = one(sp.payment)
  // Dropped when it is neither an id nor NO_RIDER, so links never carry junk.
  const byRider = riderClause(one(sp.rider))
  const rider = byRider ? one(sp.rider) : ''

  const pageParam = Number.parseInt(one(sp.page), 10)
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1
  const pageSizeParam = Number.parseInt(one(sp.pageSize), 10)
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(pageSizeParam)
    ? pageSizeParam
    : DEFAULT_PAGE_SIZE

  // Filters are additive on top of the caller's scope, never instead of it.
  // Payment is layered on last and kept separable, because the tab counts are
  // taken from everything except it.
  const base: QueryFilter<Record<string, unknown>> = {}
  if (outlet) base.restaurantId = outlet
  if (stations.length) base.stationCode = { $in: stations }
  if (status) base.status = status
  if (dateFrom || dateTo) {
    const range: Record<string, string> = {}
    if (dateFrom) range.$gte = dateFrom
    if (dateTo) range.$lte = dateTo
    base.serviceDate = range
  }
  if (train) base.trainNo = train.toUpperCase()
  if (type) base.orderType = type
  if (byRider) Object.assign(base, byRider)

  await connectDb()
  // Resolved before any query runs, so the list, its count and the payment
  // tab counts all read the very same filter.
  const search = await orderSearchClause(q)
  if (search) Object.assign(base, search)

  const filter = payment ? { ...base, paymentMode: payment } : base

  const [outlets, stationDocs, orders, paymentCounts, statusesInUse, totalCount, riders] = await Promise.all([
    Restaurant.find({}).select('name stationCode stationName').sort({ name: 1 }).lean(),
    Station.find({}).select('name').lean(),
    findMany(ctx, filter, { sort: { createdAt: -1 }, limit: pageSize, skip: (page - 1) * pageSize }),
    countByPaymentMode(ctx, base),
    distinctStatuses(ctx),
    countOrders(ctx, filter),
    riderOptions(ctx),
  ])
  const riderName = await riderNamesFor(orders)

  // Custom statuses an admin has typed in stay selectable once they exist.
  const customStatuses = statusesInUse
    .filter((s) => !(ORDER_STATUSES as readonly string[]).includes(s))
    .sort()
  const statusOptions = [...ORDER_STATUSES, ...customStatuses]

  const outletName = new Map(outlets.map((o) => [String(o._id), `${o.name} · ${o.stationCode}`]))

  // Every station an outlet sits at, plus any already picked so a selection
  // never silently drops out of the list. Named from the station record,
  // falling back to whatever an outlet calls it.
  const stationName = new Map<string, string>()
  for (const o of outlets) if (o.stationName && !stationName.has(o.stationCode)) stationName.set(o.stationCode, o.stationName)
  for (const s of stationDocs) if (s.name) stationName.set(String(s._id), s.name)
  const stationOptions = [...new Set([...outlets.map((o) => o.stationCode), ...stations])]
    .sort()
    .map((code) => ({ code, name: stationName.get(code) ?? null }))

  // Today is the default, not a filter someone set.
  const hasFilters = Boolean(
    outlet || stations.length || status || mode !== 'today' || train || type || q || payment || rider,
  )

  // Every link and the export carry the filters already in play.
  const query = (over: Record<string, string>) => {
    const u = new URLSearchParams()
    for (const [k, v] of Object.entries({
      outlet, status, mode, month, from: rawFrom, to: rawTo, train, type, q, payment, rider, ...over,
    })) {
      if (v) u.set(k, v)
    }
    for (const s of stations) u.append('station', s)
    return u.toString()
  }

  const paymentTabs = PAYMENT_TABS.map((t) => {
    const qs = query({ payment: t.value })
    return {
      href: `/admin/orders${qs ? `?${qs}` : ''}`,
      label: t.label,
      count: t.value
        ? (paymentCounts[t.value] ?? 0)
        : Object.values(paymentCounts).reduce((a, b) => a + b, 0),
      active: payment === t.value,
    }
  })

  const exportHref = `/admin/orders/export?range=all&${query({})}`

  // Separate from `query()`: a filter change should always land back on page
  // 1, but the pager itself needs to carry the current page/size forward.
  const paginationHref = ({ page: p, pageSize: ps }: { page: number; pageSize: number }) => {
    const u = new URLSearchParams()
    for (const [k, v] of Object.entries({
      outlet, status, mode, month, from: rawFrom, to: rawTo, train, type, q, payment, rider,
    })) {
      if (v) u.set(k, v)
    }
    for (const s of stations) u.append('station', s)
    if (p > 1) u.set('page', String(p))
    if (ps !== DEFAULT_PAGE_SIZE) u.set('pageSize', String(ps))
    const qs = u.toString()
    return `/admin/orders${qs ? `?${qs}` : ''}`
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="All orders"
        note={`${totalCount} order${totalCount === 1 ? '' : 's'}${
          hasFilters ? ' matching these filters' : ' today, across all outlets'
        }.`}
        action={
          <>
            <ButtonAnchor href={exportHref} download>
              <IconDownload size={15} />
              Export CSV
            </ButtonAnchor>
            <ButtonLink href="/admin/orders/new" variant="primary">
              <IconPlus size={15} />
              New order
            </ButtonLink>
          </>
        }
      />

      <Tabs label="Payment mode" tabs={paymentTabs} />

      <Card className="p-3">
        <QueryForm action="/admin/orders" className="grid items-end gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {/* The tabs own this value; without it, filtering would drop it. */}
          <input type="hidden" name="payment" value={payment} />
          <div className="relative sm:col-span-2">
            <IconSearch size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input name="q" type="search" defaultValue={q}
              placeholder="Search orders: ID, passenger, phone, train, seat, aggregator, outlet, rider…"
              autoComplete="off" spellCheck={false}
              className={`${inputClass} pl-9`} aria-label="Search orders" />
          </div>
          <StationMultiSelect name="station" options={stationOptions} defaultSelected={stations} />
          <select name="outlet" defaultValue={outlet} className={inputClass} aria-label="Outlet">
            <option value="">All outlets</option>
            {outlets.map((o) => (
              <option key={String(o._id)} value={String(o._id)}>
                {o.name} · {o.stationCode}
              </option>
            ))}
          </select>
          <select name="status" defaultValue={status} className={inputClass} aria-label="Status">
            <option value="">Any status</option>
            {statusOptions.map((s) => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>
          <input name="train" defaultValue={train} placeholder="Train number" inputMode="numeric"
            autoComplete="off" spellCheck={false}
            className={`${inputClass} font-mono`} aria-label="Train number" />
          <select name="type" defaultValue={type} className={inputClass} aria-label="Order type">
            <option value="">Any type</option>
            {ORDER_TYPES.map((t) => (
              <option key={t} value={t}>{ORDER_TYPE_LABEL[t]}</option>
            ))}
          </select>
          <select name="rider" defaultValue={rider} className={inputClass} aria-label="Rider">
            <option value="">Any rider</option>
            <option value={NO_RIDER}>No rider yet</option>
            {riders.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}{r.active ? '' : ' (inactive)'}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <Button type="submit" variant="secondary" className="flex-1">Apply</Button>
            {hasFilters ? <ButtonLink href="/admin/orders" variant="ghost">Clear</ButtonLink> : null}
          </div>
          <div className="sm:col-span-2 lg:col-span-5">
            <Field label="Date">
              <DateFilter mode={mode} month={month} from={rawFrom} to={rawTo} allowAll />
            </Field>
          </div>
        </QueryForm>
      </Card>

      <AdminOrdersTable
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
          scheduledArrival: o.scheduledArrival?.toISOString() ?? null,
          amountPaise: o.amountPaise,
          outletName: outletName.get(String(o.restaurantId)) ?? null,
          source: o.source,
          remark: o.remark,
          rider: riderName.get(String(o._id)),
            ...callNoteRow(o),
        }))}
        showOutlet
        showSource
        showRider
        statusOptions={statusOptions}
        emptyNote={
          q && mode !== 'all'
            ? 'Nothing matches in these dates. The search reads the date filter too: try All time.'
            : hasFilters
            ? 'Nothing matches these filters. Try clearing them.'
            : 'Orders arriving by email appear here automatically.'
        }
      />

      {totalCount > 0 ? (
        <Card>
          <Pagination page={page} pageSize={pageSize} total={totalCount} buildHref={paginationHref} />
        </Card>
      ) : null}
    </div>
  )
}
