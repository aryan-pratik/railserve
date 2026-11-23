import { requirePage, requirePermission } from '@/lib/session'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Download, LayoutList, Plus, Search, TrainFront } from 'lucide-react'
import { trackingNoteFor } from '@/lib/v2/kitchenView'
import { foodItemLabels } from '@/lib/orderView'
import { DateFilter } from '@/components/v2/DateFilter'
import { connectDb } from '@/lib/db'
import { countOrders, findMany } from '@/lib/repo/orderRepo'
import { findRunsWhere } from '@/lib/repo/runRepo'
import { countPendingReturns, listReturns, mayCollectReturns, returnFilterClause, returnRiders, type ReturnFilters } from '@/lib/repo/rtoRepo'
import { ReturnAge, ReturnsMarkAll } from '@/components/v2/ReturnsMarkAll'
import { Select } from '@/components/v2/Select'
import { riderNamesFor } from '@/lib/repo/riderFilter'
import { orderDietsFor } from '@/lib/repo/menuRepo'
import { hasOrderFilters, orderFilterClause, orderFilterOptions, orderFilterParams, readOrderFilters } from '@/lib/repo/orderFilters'
import { timingFor, timingForOrders } from '@/lib/train/service'
import { runKeyFor, runTrainLabel, sortRunsByUrgency } from '@/lib/runs'
import { callNoteSummary } from '@/lib/orderView'
import { PAYMENT_MODES, sourceLabel } from '@/lib/orderEnums'
import { rtoReasonLabel } from '@/lib/rto'
import { ORDER_STATUSES, reasonLabel } from '@/lib/orderStatus'
import { resolveDateRange } from '@/lib/dateFilter'
import { formatDateRange, formatIST, formatRupees, formatServiceDate, formatShortDate, formatTimeIST, todayIST } from '@/lib/format'
import {
  defaultDateMode,
  maskPhone,
  mongoSort,
  readSort,
  readView,
  runCounts,
  viewClause,
  viewHasDates,
  viewsFor,
  type OrderView,
} from '@/lib/v2/orders'
import { ButtonLink, Chip, Mono, cx, statusChip } from '@/components/v2/ui'
import { EmptyState, PageHeader, Pagination, PillTabs, Sub, Table, TableFrame, Td, Th, readPaging, rowClass } from '@/components/v2/Table'
import { OrdersFilterBar } from '@/components/v2/OrdersFilterBar'
import { OrdersMarkReturned } from '@/components/v2/OrdersMarkReturned'
import { ordersFieldClass } from '@/lib/v2/ordersShared'
import { OrdersList, type OrdersGroup, type OrdersRow } from '@/components/v2/OrdersList'
import { RememberList } from '@/components/v2/ListMemory'

export const metadata = { title: 'Orders · RailServe' }

type Clause = Record<string, unknown>
type OrderDoc = Awaited<ReturnType<typeof findMany>>[number]

/**
 * One orders table for every role. The saved views decide what is listed,
 * the filter bar narrows it, and the repo decides what the viewer may see:
 * an admin gets every outlet, a manager or telecaller only theirs.
 */
export default async function V2OrdersPage(props: PageProps<'/v2/orders'>) {
  const ctx = await requirePermission('orders.view')
  const sp = await props.searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''

  const role = ctx.role
  const isAdmin = role === 'ADMIN'
  const isTelecaller = role === 'TELECALLER'
  const now = new Date()
  const serverNowMs = now.getTime()
  const today = todayIST(now)

  const views = viewsFor(role)
  const requested = readView(sp.view)
  // A store manager works from Kitchen, which already shows their orders by
  // train, by day and by stage. The list itself is not theirs, however the
  // address is typed; only "Bags coming back" (view=returns) lives here.
  if (role === 'STORE_MANAGER' && requested !== 'returns') redirect('/v2/kitchen')
  // An admin can switch off this list, or Bags coming back, per person.
  await requirePage(requested === 'returns' ? 'returns' : 'orders')
  // The date row above the search decides the day now, so "Today" is the
  // all-orders view on today's date, and "Coming days" (upcoming) gives way
  // as soon as a date is picked. Returns and group bookings have their own
  // sidebar items and arrive here with their view in the URL.
  let view: OrderView = views.includes(requested) ? requested : 'all'
  if (view === 'today') view = 'all'
  if (view === 'upcoming' && one(sp.mode)) view = 'all'
  const grouped = one(sp.group) === '1'
  const sort = readSort(sp.sort, view)
  // How it was paid, or REFUNDED for orders with money paid back.
  const payment = (PAYMENT_MODES as readonly string[]).includes(one(sp.payment)) || one(sp.payment) === 'REFUNDED' ? one(sp.payment) : ''
  const collected = one(sp.rto) === 'collected'
  // The call desk's "Not called / Called" chips from the v1 live board: the
  // Called column reads the call log, so this clause reads the same field.
  const called = isTelecaller && (one(sp.called) === 'yes' || one(sp.called) === 'no') ? one(sp.called) : ''
  const { page, pageSize, skip } = readPaging(sp)

  const filters = readOrderFilters(sp, { defaultMode: defaultDateMode(view) })
  const datesApply = viewHasDates(view)

  await connectDb()
  const [options, filterClause] = await Promise.all([
    orderFilterOptions(ctx, filters.stations),
    // Today and Upcoming are dates already: their clause is built without the chips.
    orderFilterClause(ctx, datesApply && !(view === 'all' && filters.mode === 'today') ? filters : { ...filters, mode: 'all' }),
  ])
  // "Today" on the date row keeps the board's own rule: today's orders plus
  // last night's still-open ones on a train that is yet to come.
  const todayMode = view === 'all' && filters.mode === 'today'
  // Group bookings: open ones by default, or one stage.
  const stageParam = one(sp.stage)
  const stage = stageParam === 'ENQUIRY' || stageParam === 'QUOTED' || stageParam === 'LOST' ? stageParam : ''
  const where: Clause = {
    $and: [
      viewClause(todayMode ? 'today' : view, now),
      ...(view === 'enquiries' ? [{ status: stage ? stage : { $in: ['ENQUIRY', 'QUOTED'] } }] : []),
      filterClause,
      ...(payment === 'REFUNDED' ? [{ refund: { $ne: null } }] : payment ? [{ paymentMode: payment }] : []),
      ...(called ? [{ 'callLog.0': { $exists: called === 'yes' } }] : []),
    ],
  }

  const [returnsPending, canCollect] = await Promise.all([countPendingReturns(ctx), mayCollectReturns(ctx)])

  const outletName = new Map(options.outlets.map((o) => [o.id, o.name]))
  const showOutlet = isAdmin || ctx.restaurantIds.length > 1
  const canBulk = !isTelecaller
  const activeRiders = options.riders.filter((r) => r.active).map((r) => ({ id: r.id, name: r.name }))

  // Links carry the filters in play. A new view starts on page one and drops
  // the dates and sort, whose defaults differ per view.
  const qs = (over: { view?: OrderView; group?: boolean; page?: number; pageSize?: number; rto?: string } = {}) => {
    const v = over.view ?? view
    const u = orderFilterParams(filters)
    u.set('view', v)
    if (over.view && over.view !== view) {
      for (const k of ['mode', 'month', 'from', 'to']) u.delete(k)
    } else if (sort !== readSort(undefined, view)) {
      u.set('sort', sort)
    }
    if (over.group ?? grouped) u.set('group', '1')
    if (payment) u.set('payment', payment)
    if (called) u.set('called', called)
    const rto = over.rto ?? (collected ? 'collected' : '')
    if (v === 'returns' && rto) u.set('rto', rto)
    if (over.page && over.page > 1) u.set('page', String(over.page))
    if (over.pageSize && over.pageSize !== 20) u.set('pageSize', String(over.pageSize))
    return `/v2/orders?${u.toString()}`
  }
  const pageHref = (t: { page: number; pageSize: number }) => qs(t)

  const exportQs = orderFilterParams(filters)
  exportQs.set('range', 'all')
  exportQs.set('mode', datesApply ? filters.mode : view === 'upcoming' ? 'all' : 'today')
  if (payment) exportQs.set('payment', payment)

  const range = resolveDateRange(filters.mode, filters)
  const dateNote = !datesApply
    ? 'Booked for a later date'
    : filters.mode === 'all'
      ? 'All time'
      : formatDateRange(range.from || today, range.to || today)
  const filtered = hasOrderFilters(filters) || Boolean(payment) || Boolean(called)

  // Every view starts with this header, so the list remembers where it was
  // here (see ListMemory): back from an order returns to the same day and filters.
  const header = (note: string) => (
    <>
    <RememberList />
    <PageHeader
      title={view === 'returns' ? 'Bags coming back' : view === 'enquiries' ? 'Group bookings' : 'Orders'}
      note={note}
      actions={
        <>
          {view !== 'returns' && view !== 'enquiries' ? (
            <span className="inline-flex rounded-full border border-v2-line p-0.5" role="group" aria-label="Layout">
              <ModeLink href={qs({ group: false })} active={!grouped} icon={<LayoutList size={14} aria-hidden />} label="List" />
              <ModeLink href={qs({ group: true })} active={grouped} icon={<TrainFront size={14} aria-hidden />} label="By train" />
            </span>
          ) : null}
          {isAdmin ? (
            <a
              href={`/admin/orders/export?${exportQs}`}
              download
              aria-label="Download this list"
              title="Download this list"
              className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-full border border-v2-line-strong bg-v2-surface text-v2-ink-2 hover:bg-v2-surface-2')}
            >
              <Download size={17} aria-hidden />
            </a>
          ) : null}
          {!isTelecaller ? (
            <ButtonLink href="/v2/orders/new" variant="primary" className="h-10 w-10 !px-0" aria-label="New order" title="New order">
              <Plus size={19} strokeWidth={2.4} className="shrink-0" aria-hidden />
            </ButtonLink>
          ) : null}
        </>
      }
    />
    </>
  )

  // The date row: the one obvious place to change the day, above the search.
  const tabs = (
    <DateFilter
      key={`${view}|${filters.mode}|${filters.month}|${filters.from}|${filters.to}`}
      mode={filters.mode}
      month={filters.month}
      from={filters.from}
      to={filters.to}
      allowAll
      simple
      autoSubmit
      inactive={view === 'upcoming'}
      className="w-fit"
    />
  )

  const filterBar = (
    <div className="grid gap-3">
      <OrdersFilterBar
        filters={filters}
        options={options}
        payment={payment}
        called={called}
        sort={sort}
        showOutlet={isAdmin}
        showCalled={isTelecaller && view !== 'returns'}
        showDates={false}
        showSort={view === 'upcoming' || view === 'all'}
        hidden={{ view, group: grouped ? '1' : '', rto: view === 'returns' && collected ? 'collected' : '' }}
        clearHref={`/v2/orders?view=${view}${grouped ? '&group=1' : ''}`}
      />
    </div>
  )

  /* ── Returns ──────────────────────────────────────────────────────────── */
  if (view === 'returns') {
    // Its own filters: who is carrying the bag, which outlet, why it is
    // coming back, and a search. Bags still out ignore dates on purpose: a
    // bag is out until it is on the counter, whatever day it left.
    const why = one(sp.why) === 'CANCELLED' || one(sp.why) === 'FAILED' ? (one(sp.why) as 'CANCELLED' | 'FAILED') : null
    const rf: ReturnFilters = { riderId: one(sp.rider) || null, outletId: one(sp.outlet) || null, reason: why, q: one(sp.q) || null }
    const rtoStatus = collected ? 'RETURNED' : 'PENDING'
    const [rclause, riders] = await Promise.all([returnFilterClause(ctx, rf), returnRiders(ctx, rtoStatus)])
    const { rows, total } = await listReturns(ctx, { status: rtoStatus, limit: pageSize, skip, where: rclause })
    const anyFilter = Boolean(rf.riderId || rf.outletId || rf.reason || rf.q)
    const rHref = (over: { rto?: string; page?: number; pageSize?: number; clear?: boolean } = {}) => {
      const u = new URLSearchParams({ view: 'returns' })
      const rto = over.rto ?? (collected ? 'collected' : '')
      if (rto) u.set('rto', rto)
      if (!over.clear) {
        if (rf.riderId) u.set('rider', rf.riderId)
        if (rf.outletId) u.set('outlet', rf.outletId)
        if (rf.reason) u.set('why', rf.reason)
        if (rf.q) u.set('q', rf.q)
      }
      if (over.page && over.page > 1) u.set('page', String(over.page))
      if (over.pageSize && over.pageSize !== 20) u.set('pageSize', String(over.pageSize))
      return `/v2/orders?${u.toString()}`
    }
    return (
      <div className="grid gap-[18px]">
        {header(
          canCollect
            ? 'Bags coming back from a rider. Mark one returned once it is on the counter.'
            : `Bags coming back from a rider. ${role === 'STORE_MANAGER' ? 'An admin can allow you to mark returns on your staff record.' : 'The outlet marks them returned.'}`,
        )}
        <PillTabs
          tabs={[
            { href: rHref({ rto: '' }), label: 'To collect', count: returnsPending, active: !collected, tone: 'bad' },
            { href: rHref({ rto: 'collected' }), label: 'Collected', active: collected },
          ]}
        />
        <form action="/v2/orders" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="view" value="returns" />
          {collected ? <input type="hidden" name="rto" value="collected" /> : null}
          <Select
            name="rider"
            defaultValue={rf.riderId ?? ''}
            submitOnChange
            aria-label="Rider"
            className="w-full sm:w-56"
            options={[
              { value: '', label: 'All riders' },
              ...riders.map((r) => ({ value: r.id, label: `${r.name} · ${r.count} bag${r.count === 1 ? '' : 's'}` })),
            ]}
          />
          {showOutlet ? (
            <Select
              name="outlet"
              defaultValue={rf.outletId ?? ''}
              submitOnChange
              aria-label="Outlet"
              className="w-full sm:w-56"
              options={[{ value: '', label: 'All outlets' }, ...options.outlets.map((o) => ({ value: o.id, label: `${o.name} · ${o.stationCode}` }))]}
            />
          ) : null}
          <Select
            name="why"
            defaultValue={rf.reason ?? ''}
            submitOnChange
            aria-label="Why it is coming back"
            className="w-full sm:w-52"
            options={[
              { value: '', label: 'Any reason' },
              { value: 'FAILED', label: 'Not delivered' },
              { value: 'CANCELLED', label: 'Cancelled on the way' },
            ]}
          />
          <label className="relative block min-w-0 flex-1 basis-56">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-v2-faint" aria-hidden />
            <input
              name="q"
              type="search"
              defaultValue={rf.q ?? ''}
              placeholder="Order no., passenger, train or seat"
              autoComplete="off"
              aria-label="Search returns"
              className={cx(ordersFieldClass, 'h-10 pl-10 text-[14.5px]')}
            />
          </label>
          {anyFilter ? (
            <ButtonLink href={rHref({ clear: true })} variant="ghost" className="h-10">
              Clear
            </ButtonLink>
          ) : null}
        </form>
        {!collected && canCollect && rf.riderId && rows.length > 1 ? (
          <ReturnsMarkAll ids={rows.map((r) => r.id)} rider={riders.find((r) => r.id === rf.riderId)?.name ?? 'this rider'} />
        ) : null}
        {rows.length === 0 ? (
          <EmptyState
            title={anyFilter ? 'Nothing matches these filters' : collected ? 'Nothing collected yet' : 'Nothing to collect'}
            note={
              anyFilter
                ? 'Try clearing them, or widen the dates.'
                : collected
                  ? 'Returns marked as back at the counter are listed here.'
                  : 'When a rider cannot deliver an order, or it is cancelled on the way, it shows here until the outlet takes the bag back.'
            }
            action={anyFilter ? <ButtonLink href={rHref({ clear: true })}>Clear filters</ButtonLink> : null}
          />
        ) : (
          <TableFrame>
            <Table className="min-w-[680px]">
              <thead>
                <tr>
                  <Th>Order</Th>
                  <Th>{showOutlet ? 'Rider · outlet' : 'Rider'}</Th>
                  <Th>{collected ? 'Returned' : 'Out since'}</Th>
                  {!isTelecaller ? <Th align="right">Cash</Th> : null}
                  {/* relative: the sr-only label is absolutely positioned, and without a
                      positioned ancestor it escapes the TableFrame's scroll box and widens
                      the page on a phone. */}
                  <Th align="right" className="relative">
                    <span className="sr-only">{collected ? 'Taken back by' : 'Actions'}</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const chip = statusChip(r.status)
                  return (
                    <tr key={r.id} className={rowClass()}>
                      <Td className="align-top">
                        <span className="flex items-center gap-1.5">
                          <Link href={`/v2/orders/${r.id}`} className="font-mono text-[13px] font-semibold hover:underline">
                            {r.externalOrderId}
                          </Link>
                          <Chip tone={chip.tone}>{chip.label}</Chip>
                        </span>
                        <Sub>
                          {[r.trainNo, r.rawSeat, r.contactName, `${r.itemCount} item${r.itemCount === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
                        </Sub>
                        <Sub className="text-v2-ink-2">
                          {[rtoReasonLabel(r.reason), r.failureReason !== rtoReasonLabel(r.reason) ? r.failureReason : null].filter(Boolean).join(': ')}
                          {r.note ? ` · “${r.note}”` : ''}
                        </Sub>
                      </Td>
                      <Td className="align-top">
                        {r.riders.length ? r.riders.join(', ') : <span className="text-v2-faint">—</span>}
                        {showOutlet ? <Sub className="truncate max-w-[16rem]">{r.outletName ?? '—'}</Sub> : null}
                      </Td>
                      <Td className="align-top">
                        <Mono className="text-xs text-v2-muted">{formatIST(collected ? r.returnedAt : r.openedAt)}</Mono>
                        {!collected ? <ReturnAge openedAt={r.openedAt} nowMs={serverNowMs} /> : null}
                      </Td>
                      {!isTelecaller ? (
                        <Td align="right" className="align-top">
                          {r.codPaise !== null ? (
                            <span className="inline-flex flex-col items-end gap-1">
                              <Mono className="font-semibold">{formatRupees(r.codPaise)}</Mono>
                              <Chip tone="cod">not collected</Chip>
                            </span>
                          ) : (
                            <span className="text-v2-faint">—</span>
                          )}
                        </Td>
                      ) : null}
                      <Td align="right" className="align-top">
                        {collected ? (
                          <span className="text-xs text-v2-muted">{r.returnedBy ?? '—'}</span>
                        ) : canCollect ? (
                          <OrdersMarkReturned orderId={r.id} externalOrderId={r.externalOrderId} />
                        ) : (
                          <span className="text-xs text-v2-faint">Waiting</span>
                        )}
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={pageSize} total={total} buildHref={(t) => rHref(t)} className="border-t border-v2-line" />
          </TableFrame>
        )}
      </div>
    )
  }

  /* ── Enquiries ────────────────────────────────────────────────────────── */
  if (view === 'enquiries') {
    const [rows, total] = await Promise.all([
      findMany(ctx, where, { sort: { createdAt: -1, _id: -1 }, limit: pageSize, skip }),
      countOrders(ctx, where),
    ])
    return (
      <div className="grid gap-[18px]">
        {header(`${total} group booking${total === 1 ? '' : 's'} · they reach a kitchen once quoted and confirmed`)}
        <PillTabs
          tabs={[
            { href: '/v2/orders?view=enquiries', label: 'Open', active: stage === '' },
            { href: '/v2/orders?view=enquiries&stage=ENQUIRY', label: 'Asking', active: stage === 'ENQUIRY' },
            { href: '/v2/orders?view=enquiries&stage=QUOTED', label: 'Quoted', active: stage === 'QUOTED' },
            { href: '/v2/orders?view=enquiries&stage=LOST', label: 'Not booked', active: stage === 'LOST' },
          ]}
        />
        {tabs}
        {filterBar}
        {rows.length === 0 ? (
          <EmptyState
            title={filtered ? 'Nothing matches these filters' : 'No open enquiries'}
            note={filtered ? 'Try clearing them, or widen the dates.' : 'Paste a WhatsApp message into the composer to start one.'}
            action={filtered ? <ButtonLink href="/v2/orders?view=enquiries">Clear filters</ButtonLink> : <ButtonLink href="/v2/orders/new" variant="primary">New enquiry</ButtonLink>}
          />
        ) : (
          <TableFrame>
            <Table className="min-w-[720px]">
              <thead>
                <tr>
                  <Th>Enquiry</Th>
                  <Th>For</Th>
                  <Th>Station</Th>
                  <Th align="right">Pax</Th>
                  <Th align="right">Quoted</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => {
                  const chip = statusChip(o.status)
                  const lost = o.status === 'LOST'
                  return (
                    <tr key={String(o._id)} className={cx(rowClass(), lost && 'text-v2-muted')}>
                      <Td>
                        <Link href={`/v2/orders/${String(o._id)}`} className="font-mono text-[13px] font-semibold hover:underline">
                          {o.externalOrderId}
                        </Link>
                        <Sub>{[o.contactName, maskPhone(o.contactPhone)].filter(Boolean).join(' · ') || sourceLabel(o.source)}</Sub>
                      </Td>
                      <Td>
                        <span title={formatServiceDate(o.serviceDate)}>{formatShortDate(o.serviceDate)}</span>
                        {o.trainNo ? <Sub className="font-mono">{o.trainNo}</Sub> : null}
                      </Td>
                      <Td>
                        <Mono>{o.stationCode}</Mono>
                        {o.handoverPoint ? <Sub className="max-w-[16rem] truncate">{o.handoverPoint}</Sub> : null}
                      </Td>
                      <Td align="right">
                        <Mono>{o.pax ?? '—'}</Mono>
                      </Td>
                      <Td align="right">
                        {o.amountPaise ? <Mono className="font-semibold">{formatRupees(o.amountPaise)}</Mono> : <span className="text-v2-faint">Not quoted</span>}
                      </Td>
                      <Td>
                        <Chip tone={chip.tone}>{chip.label}</Chip>
                        {lost && o.delivery?.failureReason ? <Sub>{reasonLabel(o.delivery.failureReason)}</Sub> : null}
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={pageSize} total={total} buildHref={pageHref} className="border-t border-v2-line" />
          </TableFrame>
        )}
      </div>
    )
  }

  /* ── Orders: Today, Upcoming, Cancelled, All ──────────────────────────── */
  // A store manager works by seat and dish, not by order number.
  const columns = { outlet: showOutlet, amount: !isTelecaller, called: isTelecaller, date: !todayMode, orderNo: role !== 'STORE_MANAGER' }

  const toRows = async (orders: OrderDoc[], timingOf: (o: OrderDoc) => { etaIso: string | null; arrived: boolean }): Promise<OrdersRow[]> => {
    const [riderName, diets] = await Promise.all([riderNamesFor(ctx, orders), orderDietsFor(ctx.tenantId, orders)])
    return orders.map((o) => {
      const t = timingOf(o)
      const note = callNoteSummary(o.callLog ?? [])
      return {
        id: String(o._id),
        runKey: runKeyFor(o),
        externalOrderId: o.externalOrderId,
        orderType: o.orderType,
        source: o.source ?? null,
        placedLabel: formatTimeIST(o.createdAt),
        dateLabel: formatShortDate(o.serviceDate),
        diet: diets.get(String(o._id)) ?? null,
        callNoteCount: note.count,
        callNoteHint: note.hint,
        trainNo: o.trainNo ?? null,
        trainName: o.trainName ?? null,
        coach: o.coach ?? null,
        berth: o.berth ?? null,
        rawSeat: o.rawSeat ?? null,
        handoverPoint: o.handoverPoint ?? null,
        contactName: o.contactName ?? null,
        phoneMasked: maskPhone(o.contactPhone),
        outletName: o.restaurantId ? (outletName.get(String(o.restaurantId)) ?? null) : null,
        status: o.status,
        etaIso: t.etaIso,
        arrived: t.arrived,
        bookedLabel: o.scheduledArrival ? formatTimeIST(o.scheduledArrival) : null,
        amountPaise: isTelecaller ? null : (o.amountPaise ?? null),
        paymentMode: o.paymentMode ?? null,
        refundPaise: o.refund?.amountPaise ?? null,
        ratingOrder: o.ratingOrder === true,
        rider: riderName.get(String(o._id)) || null,
        pax: o.pax ?? null,
        itemNames: foodItemLabels(o.items),
        note: o.kotNote?.trim() || o.remark?.trim() || null,
      }
    })
  }

  let rows: OrdersRow[] = []
  let groups: OrdersGroup[] = []
  let total = 0
  let orderCount = 0

  if (grouped) {
    // Whole trains, urgency-sorted from the same cache-only timing read the
    // kitchen board uses. Paged by train, so a run is never cut in half.
    const found = await findRunsWhere(ctx, where)
    const timings = await timingForOrders(found.flatMap((r) => r.orders), { allowFetch: false })
    const timingOfRun = (run: (typeof found)[number]) => timingFor(run.orders[0], timings)
    const ordered =
      sort === 'newest'
        ? [...found].sort((a, b) => newest(b.orders) - newest(a.orders))
        : sortRunsByUrgency(found, (r) => timingOfRun(r).effectiveArrival, serverNowMs)
    total = ordered.length
    orderCount = found.reduce((n, r) => n + r.orders.length, 0)
    const pageRuns = ordered.slice(skip, skip + pageSize)
    const pageRows = await toRows(pageRuns.flatMap((r) => r.orders), (o) => {
      const t = timingFor(o, timings)
      return { etaIso: t.effectiveArrival?.toISOString() ?? null, arrived: t.arrived }
    })
    const rowById = new Map(pageRows.map((r) => [r.id, r]))
    groups = pageRuns.map((run) => {
      const t = timingOfRun(run)
      return {
        header: {
          trainLabel: runTrainLabel(run),
          trainName: run.trainName,
          stationCode: run.stationCode,
          etaIso: t.effectiveArrival?.toISOString() ?? null,
          bookedIso: t.scheduledArrival?.toISOString() ?? null,
          platform: t.platform,
          delayMinutes: t.delayMinutes,
          arrived: t.arrived,
          counts: runCounts(run.orders.map((o) => o.status)),
          startDateLabel: run.serviceDate !== today ? `Started ${formatShortDate(run.serviceDate)}` : null,
          summary: null,
          trackingNote: trackingNoteFor(t),
        },
        rows: run.orders.map((o) => rowById.get(String(o._id))!),
      }
    })
  } else {
    const [orders, count] = await Promise.all([
      findMany(ctx, where, { sort: mongoSort(sort), limit: pageSize, skip }),
      countOrders(ctx, where),
    ])
    total = count
    orderCount = count
    // Only open orders need the live reading; a closed one shows its booked time.
    const timings = await timingForOrders(
      orders.filter((o) => ['RECEIVED', 'ACCEPTED', 'KOT_PRINTED', 'PREPARED', 'DISPATCHED'].includes(o.status)),
      { allowFetch: false },
    )
    rows = await toRows(orders, (o) => {
      const t = timingFor(o, timings)
      return { etaIso: t.effectiveArrival?.toISOString() ?? null, arrived: t.arrived }
    })
  }

  const empty = rows.length === 0 && groups.length === 0
  const note = `${dateNote} · ${orderCount} order${orderCount === 1 ? '' : 's'}${grouped ? ` on ${total} train${total === 1 ? '' : 's'}` : ''}${filtered ? ' matching these filters' : ''}`

  return (
    <div className="grid gap-[18px]">
      {header(note)}
      {tabs}
      {filterBar}
      {empty ? (
        <EmptyState
          title={filtered ? 'Nothing matches these filters' : view === 'upcoming' ? 'Nothing booked ahead' : view === 'cancelled' ? 'Nothing cancelled' : 'No orders'}
          note={
            filtered
              ? filters.q && datesApply && filters.mode !== 'all'
                ? 'The search reads the dates too: try All time.'
                : 'Try clearing them, or widen the dates.'
              : view === 'upcoming'
                ? 'Bulk orders booked for a later date appear here.'
                : view === 'cancelled'
                  ? 'Orders that were cancelled, failed or refunded are listed here.'
                  : `No orders for ${dateNote}. New orders appear here as they arrive.`
          }
          action={
            filtered ? (
              <ButtonLink href={`/v2/orders?view=${view}`}>Clear filters</ButtonLink>
            ) : !isTelecaller ? (
              <ButtonLink href="/v2/orders/new" variant="primary">
                New order
              </ButtonLink>
            ) : null
          }
        />
      ) : (
        <OrdersList
          mode={grouped ? 'grouped' : 'flat'}
          rows={rows}
          groups={groups}
          serverNowMs={serverNowMs}
          columns={columns}
          canBulk={canBulk}
          canOverride={isAdmin}
          // Only the fixed list: the server refuses a typed-in status now.
          statusOptions={options.statuses.filter((st) => (ORDER_STATUSES as readonly string[]).includes(st))}
          riders={activeRiders}
          footer={<Pagination page={page} pageSize={pageSize} total={total} buildHref={pageHref} className="border-t border-v2-line" />}
        />
      )}
    </div>
  )
}

function ModeLink({ href, active, icon, label }: { href: string; active: boolean; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={cx(
        'inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition-colors',
        active ? 'bg-v2-ink text-v2-bg' : 'text-v2-ink-2 hover:bg-v2-surface-2',
      )}
    >
      {icon}
      {label}
    </Link>
  )
}

function newest(orders: { createdAt: Date }[]): number {
  return Math.max(0, ...orders.map((o) => o.createdAt?.getTime() ?? 0))
}

