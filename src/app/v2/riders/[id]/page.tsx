import Link from 'next/link'
import type { QueryFilter } from 'mongoose'
import { notFound } from 'next/navigation'
import { ArrowLeft, Pencil, Phone } from 'lucide-react'
import { requirePermission } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { Restaurant, RiderLocation, User, type OrderDoc } from '@/lib/models'
import { countOrders, findMany, onClosedRecord, onRiderRecord } from '@/lib/repo/orderRepo'
import { activityFeed, type ActivityEntry } from '@/lib/repo/activityRepo'
import { NO_RIDER_DAY, NO_RIDER_NOW, closedBetween, opsSpan, riderDays, riderDoneFilter, ridersNow } from '@/lib/repo/riderLedgerRepo'
import { collectionHistory, pendingCashFor, receiversOf } from '@/lib/repo/riderCashRepo'
import { opsDayOf } from '@/lib/opsDay'
import { RIDER_LABEL, riderStatus } from '@/lib/orderViews'
import { resolveDateRange, type DateFilterMode } from '@/lib/dateFilter'
import { formatDateRange, formatIST, formatRupees, formatShortDate, formatTimeIST, shiftServiceDate } from '@/lib/format'
import { PRESENCE_LABEL, ageLabel, presenceOf } from '@/lib/riderLocation'
import { TERMINAL_STATUSES } from '@/lib/orderStatus'
import { ROLE_LABEL, type Role } from '@/lib/roles'
import { canSeeRider } from '@/lib/v2/riders'
import { eventDetail } from '@/components/EventLog'
import { QueryForm } from '@/components/QueryForm'
import { Avatar, Button, ButtonLink, Card, Chip, Mono, Seat, cx, statusChip, v2Focus } from '@/components/v2/ui'
import { EmptyState, KeyValue, Pagination, PillTabs, Sub, Table, TableFrame, Td, Th, readPaging, rowClass } from '@/components/v2/Table'
import { riderInputClass } from '@/lib/v2/ridersShared'

export const metadata = { title: 'Rider · RailServe' }
export const dynamic = 'force-dynamic'

const NOT_DELIVERED = ['FAILED', 'MISSED_DELIVERY', 'MISDELIVERY']
const WAITING = ['RECEIVED', 'ACCEPTED', 'KOT_PRINTED', 'PREPARED']
const BUCKETS = {
  waiting: 'Waiting for pickup',
  'on-the-way': 'In hand',
  delivered: 'Delivered',
  'not-delivered': 'Not delivered',
  cancelled: 'Cancelled',
} as const
type Bucket = keyof typeof BUCKETS

type Delivery = {
  agentIds?: unknown[] | null
  assignedAt?: Date | null
  dispatchedAt?: Date | null
  deliveredAt?: Date | null
  proofType?: string | null
  amountCollectedPaise?: number | null
  failureReason?: string | null
  closedAt?: Date | null
  codSettledAt?: Date | null
}

/** When the order closed: the stamp, or the first event into a closing status. */
function closedAt(order: OrderDoc): Date | null {
  const d = order.delivery as Delivery | undefined
  if (d?.closedAt) return d.closedAt
  if (order.status === 'DELIVERED' && d?.deliveredAt) return d.deliveredAt
  return order.events.find((e) => (TERMINAL_STATUSES as readonly string[]).includes(e.toStatus))?.createdAt ?? null
}

/** Where a COD order's cash is. Null when there is no cash. */
function cashState(order: OrderDoc): { amount: string; state: string; settled: boolean } | null {
  if (order.paymentMode !== 'COD') return null
  const d = order.delivery as Delivery | undefined
  const amount = formatRupees(d?.amountCollectedPaise ?? order.amountPaise)
  if (order.status === 'DISPATCHED') return { amount, state: 'To collect', settled: false }
  if (order.status !== 'DELIVERED') return { amount, state: 'Not collected', settled: false }
  if (d?.codSettledAt) return { amount, state: `Handed in ${formatIST(d.codSettledAt)}`, settled: true }
  return { amount, state: 'With rider', settled: false }
}

/**
 * One rider's record: every order they were on and everything they did, read
 * from the rider ledger (the same source and 3am-to-3am day as the rider's
 * own app and the Riders board). The event log is the rider's slice of the
 * activity log, which only an admin may read.
 */
export default async function V2RiderDetailPage(props: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requirePermission('riders.manage')
  const { id } = await props.params
  if (!(await canSeeRider(ctx, id))) notFound()
  const isAdmin = ctx.role === 'ADMIN'

  await connectDb()
  const rider = await User.findOne({ _id: id, tenantId: ctx.tenantId }).select('name phone role active restaurantIds isTeamLead teamLeadId canReceiveCash').lean()
  if (!rider || rider.role !== 'DELIVERY_AGENT') notFound()
  const riderId = rider._id

  const sp = await props.searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''
  const tabParam = one(sp.tab)
  const tab = tabParam === 'log' && isAdmin ? 'log' : tabParam === 'cash' ? 'cash' : 'orders'
  const bucketParam = one(sp.status)
  const bucket = bucketParam in BUCKETS ? (bucketParam as Bucket) : null
  const orderTerm = one(sp.order).trim()
  const mode = (one(sp.mode) || 'today') as DateFilterMode
  const month = one(sp.month)
  const rawFrom = one(sp.from)
  const rawTo = one(sp.to)
  const { page, pageSize, skip } = readPaging(sp)

  // The dates picked are reporting days: "today" before 3am is still the day
  // that began yesterday at 3am.
  const today = opsDayOf()
  const resolved = resolveDateRange(mode, { month, from: rawFrom, to: rawTo })
  const dateFrom = mode === 'today' ? today : mode === 'yesterday' ? shiftServiceDate(today, -1) : resolved.from
  const dateTo = mode === 'today' ? today : mode === 'yesterday' ? shiftServiceDate(today, -1) : resolved.to
  const dated = Boolean(dateFrom || dateTo)
  const span = opsSpan(dateFrom, dateTo)
  const includesNow = !dated || (dateTo || today) >= today

  const mine = onRiderRecord(riderId)
  const finished = (statuses?: QueryFilter<OrderDoc>): QueryFilter<OrderDoc> => ({
    $and: [onClosedRecord(riderId), riderDoneFilter('all'), closedBetween(span.from, span.to), ...(statuses ? [statuses] : [])],
  })
  // Live orders are "right now": a range that ended before today has none.
  const live = (statuses: string[]): QueryFilter<OrderDoc> => (includesNow ? { $and: [mine, { status: { $in: statuses } }] } : { _id: { $exists: false } })
  const BUCKET_FILTER: Record<Bucket, QueryFilter<OrderDoc>> = {
    waiting: live(WAITING),
    'on-the-way': live(['DISPATCHED']),
    delivered: finished({ status: 'DELIVERED' }),
    'not-delivered': finished({ status: { $in: NOT_DELIVERED } }),
    cancelled: finished({ status: { $nin: ['DELIVERED', ...NOT_DELIVERED] } }),
  }
  const allFilter: QueryFilter<OrderDoc> = includesNow ? { $or: [finished(), live([...WAITING, 'DISPATCHED'])] } : finished()
  const listFilter: QueryFilter<OrderDoc> = bucket ? BUCKET_FILTER[bucket] : allFilter

  const [days, nows, due, collections, collectedInSpan, orders, listed, allCount, log, location, outlets, lead, team] = await Promise.all([
    riderDays(ctx, [riderId], span),
    ridersNow(ctx, [riderId]),
    pendingCashFor(ctx, riderId),
    collectionHistory(ctx, [riderId], { limit: 100_000 }),
    collectionHistory(ctx, [riderId], { from: span.from, to: span.to, limit: 100_000 }),
    tab === 'orders' ? findMany(ctx, listFilter, { sort: { 'delivery.closedAt': -1, 'delivery.dispatchedAt': -1, createdAt: -1 }, skip, limit: pageSize }) : Promise.resolve([]),
    tab === 'orders' ? countOrders(ctx, listFilter) : Promise.resolve(0),
    tab === 'orders' ? countOrders(ctx, allFilter) : Promise.resolve(0),
    isAdmin
      ? activityFeed(ctx, {
          range: dated ? span : null,
          riderId: String(riderId),
          orderId: tab === 'log' ? orderTerm || null : null,
          skip: tab === 'log' ? skip : 0,
          limit: tab === 'log' ? pageSize : 1,
        })
      : Promise.resolve(null),
    RiderLocation.findOne({ tenantId: ctx.tenantId, userId: riderId }).select('recordedAt').lean(),
    Restaurant.find({ _id: { $in: rider.restaurantIds ?? [] }, tenantId: ctx.tenantId }).select('name stationCode').sort({ name: 1 }).lean(),
    rider.teamLeadId ? User.findOne({ _id: rider.teamLeadId, tenantId: ctx.tenantId }).select('name').lean() : null,
    rider.isTeamLead ? User.countDocuments({ tenantId: ctx.tenantId, role: 'DELIVERY_AGENT', teamLeadId: riderId }) : 0,
  ])
  const receivers = await receiversOf(ctx, collections)

  const day = days.get(String(riderId)) ?? NO_RIDER_DAY
  const now = includesNow ? (nows.get(String(riderId)) ?? NO_RIDER_NOW) : NO_RIDER_NOW
  const bucketCount: Record<Bucket, number> = {
    waiting: now.waiting,
    'on-the-way': now.inHand,
    delivered: day.delivered,
    'not-delivered': day.notDelivered,
    cancelled: day.cancelled,
  }
  // The list's own total, so the All chip agrees with the pager (older dispatched orders are listed but not in the day's figures).
  const all = tab === 'orders' ? allCount : day.done + now.inHand + now.waiting
  const presence = presenceOf(location?.recordedAt ?? null)
  const first = rider.name.split(/\s+/)[0]

  // Every filter in play, so tabs, buckets, the date and the pager keep each other.
  const current = {
    tab: tab === 'orders' ? '' : tab,
    status: bucket ?? '',
    order: tab === 'log' ? orderTerm : '',
    mode: mode === 'today' ? '' : mode,
    month: mode === 'custom-month' ? month : '',
    from: mode === 'range' ? rawFrom : '',
    to: mode === 'range' ? rawTo : '',
  }
  const href = (over: Partial<typeof current>, target?: { page: number; pageSize: number }) => {
    const u = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...current, ...over })) if (v) u.set(k, v)
    if (target) {
      if (target.page > 1) u.set('page', String(target.page))
      if (target.pageSize !== 20) u.set('pageSize', String(target.pageSize))
    }
    const qs = u.toString()
    return `/v2/riders/${id}${qs ? `?${qs}` : ''}`
  }
  const spanLabel = dated ? `${formatDateRange(dateFrom || dateTo, dateTo || today)} · 3am to 3am` : 'All time'
  const logHref = (externalOrderId: string) => href({ tab: 'log', status: '', order: externalOrderId })
  const collectedInSpanPaise = collectedInSpan.reduce((a, c) => a + c.paise, 0)

  return (
    <div className="grid gap-[18px]">
      <Link href="/v2/riders" className={cx('inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-v2-muted hover:text-v2-ink', v2Focus)}>
        <ArrowLeft size={16} strokeWidth={2} aria-hidden />
        Riders
      </Link>

      <Card>
        <div className="flex flex-wrap items-start gap-4">
          <Avatar name={rider.name} size={56} className={cx(rider.active === false && 'opacity-50 grayscale')} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[30px] font-bold leading-none tracking-[-0.03em]">{rider.name}</h1>
              {rider.active === false ? <Chip tone="grey">Inactive</Chip> : <Chip tone={presence === 'LIVE' ? 'ok' : 'grey'}>{PRESENCE_LABEL[presence]}</Chip>}
              {rider.isTeamLead ? <Chip tone="info">Team leader</Chip> : null}
            </div>
            <KeyValue
              className="mt-3"
              rows={[
                {
                  label: 'Phone',
                  value: (
                    <a href={`tel:${rider.phone}`} className={cx('font-mono tabular-nums hover:text-v2-brand', v2Focus)}>
                      {rider.phone}
                    </a>
                  ),
                },
                { label: 'Outlets', value: outlets.length ? outlets.map((o) => `${o.name} (${o.stationCode})`).join(', ') : <span className="text-v2-faint">None</span> },
                {
                  label: 'Team',
                  value: rider.isTeamLead
                    ? `Leads ${team} rider${team === 1 ? '' : 's'}${rider.canReceiveCash ? ' · may receive their cash' : ' · may not receive cash'}`
                    : lead
                      ? `Team ${lead.name}`
                      : 'No team',
                },
                { label: 'Location', value: location?.recordedAt ? `last shared ${ageLabel(location.recordedAt)}` : 'never shared' },
              ]}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`tel:${rider.phone}`}>
              <Phone size={15} strokeWidth={2} aria-hidden />
              Call
            </ButtonLink>
            <ButtonLink href={`/v2/riders?edit=${id}`}>
              <Pencil size={15} strokeWidth={2} aria-hidden />
              Edit
            </ButtonLink>
            {due.paise > 0 ? (
              <ButtonLink href={`/v2/riders?collect=${id}`} variant="primary">
                Collect {formatRupees(due.paise)}
              </ButtonLink>
            ) : null}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 xl:grid-cols-5">
        <Stat label="In hand now" value={String(now.inHand)} note={`${now.waiting} waiting for pickup${now.stale ? ` · ${now.stale} older, never closed` : ''}${now.inHandCodPaise ? ` · ${formatRupees(now.inHandCodPaise)} COD to collect` : ''}`} />
        <Stat label="Finished" value={String(day.done)} note={`${day.delivered} delivered · ${day.notDelivered} not delivered · ${day.cancelled} cancelled`} />
        <Stat label="Delivered" value={String(day.delivered)} note={`${day.codOrders} COD · ${day.prepaidOrders} prepaid · ${formatRupees(day.deliveredPaise)}`} />
        <Stat label="COD collected" value={formatRupees(day.codPaise)} note={`${formatRupees(collectedInSpanPaise)} handed in on these dates`} />
        <Stat label="COD due now" value={formatRupees(due.paise)} note={`${due.orders} delivered COD order${due.orders === 1 ? '' : 's'} not yet received · all days`} warm={due.paise > 0} />
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <PillTabs
            tabs={[
              { href: href({ mode: 'all', month: '', from: '', to: '' }), label: 'All time', active: mode === 'all' },
              { href: href({ mode: '', month: '', from: '', to: '' }), label: 'Today', active: mode === 'today' },
              { href: href({ mode: 'yesterday', month: '', from: '', to: '' }), label: 'Yesterday', active: mode === 'yesterday' },
              { href: href({ mode: 'month', month: '', from: '', to: '' }), label: 'This month', active: mode === 'month' },
            ]}
          />
          <QueryForm action={`/v2/riders/${id}`} className="flex flex-wrap items-center gap-2">
            {current.tab ? <input type="hidden" name="tab" value={current.tab} /> : null}
            {current.status ? <input type="hidden" name="status" value={current.status} /> : null}
            <input type="hidden" name="mode" value="range" />
            <label className="sr-only" htmlFor="rider-from">
              From
            </label>
            <input id="rider-from" type="date" name="from" defaultValue={mode === 'range' ? rawFrom : ''} max={today} className={cx(riderInputClass, 'h-9 w-44! rounded-full font-mono')} />
            <span className="text-xs text-v2-muted">to</span>
            <label className="sr-only" htmlFor="rider-to">
              To
            </label>
            <input id="rider-to" type="date" name="to" defaultValue={mode === 'range' ? rawTo : ''} max={today} className={cx(riderInputClass, 'h-9 w-44! rounded-full font-mono')} />
            <Button type="submit" size="sm" variant={mode === 'range' ? 'dark' : 'secondary'}>
              Apply
            </Button>
          </QueryForm>
          <span className="ml-auto text-xs text-v2-muted">{spanLabel}</span>
        </div>
      </Card>

      <PillTabs
        tabs={[
          { href: href({ tab: '', order: '' }), label: 'Orders', count: all, active: tab === 'orders' },
          { href: href({ tab: 'cash', status: '', order: '' }), label: 'Cash collected', count: collections.length, active: tab === 'cash' },
          ...(isAdmin && log ? [{ href: href({ tab: 'log', status: '' }), label: 'Event log', count: log.total, active: tab === 'log' }] : []),
        ]}
      />

      {tab === 'orders' ? (
        <>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Where the order ended up">
            {[{ key: '', label: 'All', count: all }, ...(Object.keys(BUCKETS) as Bucket[]).map((b) => ({ key: b, label: BUCKETS[b], count: bucketCount[b] }))].map((b) => {
              const on = (bucket ?? '') === b.key
              return (
                <Link
                  key={b.key}
                  href={href({ status: b.key })}
                  aria-current={on ? 'true' : undefined}
                  className={cx(
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-semibold',
                    on ? 'bg-v2-ink text-v2-bg' : 'bg-v2-surface-2 text-v2-ink-2 hover:bg-v2-sunken',
                    v2Focus,
                  )}
                >
                  {b.label}
                  <span className="font-mono text-[11px] tabular-nums opacity-70">{b.count}</span>
                </Link>
              )
            })}
          </div>

          {orders.length === 0 ? (
            <EmptyState
              title={all === 0 ? 'No orders yet' : 'No orders here'}
              note={all === 0 ? `${first} has not been on any order${dated ? ' on these dates' : ''}.` : 'Nothing in this group on these dates. Pick another group or widen the dates.'}
            />
          ) : (
            <TableFrame>
              <Table className="min-w-[60rem]">
                <thead>
                  <tr>
                    <Th>Order</Th>
                    <Th>Station</Th>
                    <Th>Payment</Th>
                    <Th>Assigned</Th>
                    <Th>Picked up</Th>
                    <Th>Outcome</Th>
                    <Th>Cash</Th>
                    <Th align="right">
                      <span className="sr-only">Log</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => {
                    const d = o.delivery as Delivery | undefined
                    const cash = cashState(o)
                    const others = (o.delivery?.agentIds ?? []).filter((a) => String(a) !== String(riderId)).length
                    const chip = statusChip(o.status)
                    const closed = closedAt(o)
                    return (
                      <tr key={String(o._id)} className={rowClass()}>
                        <Td className="max-w-[18rem] whitespace-normal">
                          <Link href={`/v2/orders/${o._id}`} className={cx('font-mono font-semibold text-v2-brand underline-offset-2 hover:underline', v2Focus)}>
                            {o.externalOrderId}
                          </Link>
                          <Sub>
                            {formatShortDate(o.serviceDate)}
                            {o.trainNo ? (
                              <>
                                {' · '}
                                <Mono>{o.trainNo}</Mono>
                              </>
                            ) : null}{' '}
                            <Seat coach={o.coach} berth={o.berth} />
                          </Sub>
                          {o.contactName ? <Sub className="font-medium text-v2-ink-2">{o.contactName}</Sub> : null}
                          {others > 0 ? (
                            <Sub>
                              with {others} other rider{others === 1 ? '' : 's'}
                            </Sub>
                          ) : null}
                        </Td>
                        <Td>
                          <Mono>{o.stationCode}</Mono>
                        </Td>
                        <Td>
                          <Chip tone={o.paymentMode === 'COD' ? 'cod' : 'grey'}>{o.paymentMode === 'COD' ? 'COD' : 'Prepaid'}</Chip>
                          <Sub>
                            <Mono>{formatRupees(o.amountPaise)}</Mono>
                          </Sub>
                        </Td>
                        <Td>
                          <Mono className="text-xs text-v2-muted">{d?.assignedAt ? formatIST(d.assignedAt) : '—'}</Mono>
                        </Td>
                        <Td>
                          <Mono className="text-xs">{d?.dispatchedAt ? formatIST(d.dispatchedAt) : '—'}</Mono>
                        </Td>
                        <Td className="whitespace-normal">
                          <Chip tone={chip.tone}>{chip.label}</Chip>
                          <Sub>
                            {RIDER_LABEL[riderStatus(o)]}
                            {closed ? (
                              <>
                                {' · '}
                                <Mono>{formatIST(closed)}</Mono>
                              </>
                            ) : null}
                          </Sub>
                          {d?.proofType && o.status === 'DELIVERED' ? <Sub>Proof: {d.proofType.toLowerCase()}</Sub> : null}
                          {d?.failureReason && o.status !== 'DELIVERED' ? <Sub className="max-w-[16rem] truncate text-v2-bad">{d.failureReason}</Sub> : null}
                        </Td>
                        <Td>
                          {cash ? (
                            <>
                              <Mono className="font-semibold">{cash.amount}</Mono>
                              <Sub className={cash.settled ? 'text-v2-ok' : undefined}>{cash.state}</Sub>
                            </>
                          ) : (
                            <span className="text-v2-faint">—</span>
                          )}
                        </Td>
                        <Td align="right">
                          {isAdmin ? (
                            <Link href={logHref(o.externalOrderId)} className={cx('text-xs font-semibold text-v2-brand underline-offset-2 hover:underline', v2Focus)} aria-label={`Event log for ${o.externalOrderId}`}>
                              Log
                            </Link>
                          ) : null}
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
              <Pagination page={page} pageSize={pageSize} total={listed} buildHref={(t) => href({}, t)} className="border-t border-v2-line" />
            </TableFrame>
          )}
        </>
      ) : tab === 'cash' ? (
        collections.length === 0 && due.paise === 0 ? (
          <EmptyState title="No handovers yet" note={`Nobody has received cash from ${first} yet.`} />
        ) : (
          <TableFrame>
            <Table>
              <thead>
                <tr>
                  <Th>Received</Th>
                  <Th>Received by</Th>
                  <Th align="right">COD orders</Th>
                  <Th align="right">Amount</Th>
                </tr>
              </thead>
              <tbody>
                {due.paise > 0 ? (
                  <tr className={rowClass()}>
                    <Td className="font-semibold text-v2-cod">Not yet received</Td>
                    <Td className="text-v2-muted">With {first}</Td>
                    <Td align="right">
                      <Mono>{due.orders}</Mono>
                    </Td>
                    <Td align="right">
                      <Mono className="font-semibold text-v2-cod">{formatRupees(due.paise)}</Mono>
                    </Td>
                  </tr>
                ) : null}
                {collections.slice(skip, skip + pageSize).map((c) => {
                  const by = c.receivedById ? receivers.get(c.receivedById) : null
                  return (
                    <tr key={c.id} className={rowClass()}>
                      <Td>
                        <Mono>{formatIST(c.at)}</Mono>
                      </Td>
                      <Td>
                        {by ? (
                          <>
                            {by.name} <Sub className="inline text-v2-faint">{by.label}</Sub>
                          </>
                        ) : (
                          <span className="text-v2-faint">—</span>
                        )}
                      </Td>
                      <Td align="right">
                        <Mono>{c.orders}</Mono>
                      </Td>
                      <Td align="right">
                        <Mono className="font-semibold text-v2-ok">{formatRupees(c.paise)}</Mono>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={pageSize} total={collections.length} buildHref={(t) => href({}, t)} className="border-t border-v2-line" />
          </TableFrame>
        )
      ) : log ? (
        <TableFrame>
          <QueryForm action={`/v2/riders/${id}`} className="flex flex-wrap items-center gap-2 border-b border-v2-line px-3.5 py-2.5">
            <input type="hidden" name="tab" value="log" />
            {current.mode ? <input type="hidden" name="mode" value={current.mode} /> : null}
            {current.month ? <input type="hidden" name="month" value={current.month} /> : null}
            {current.from ? <input type="hidden" name="from" value={current.from} /> : null}
            {current.to ? <input type="hidden" name="to" value={current.to} /> : null}
            <label className="sr-only" htmlFor="rider-log-order">
              Order id
            </label>
            <input id="rider-log-order" name="order" defaultValue={orderTerm} placeholder="Filter by order id" className={cx(riderInputClass, 'h-9 w-56! rounded-full font-mono')} />
            <Button type="submit" size="sm">
              Filter
            </Button>
            {orderTerm ? (
              <ButtonLink href={href({ order: '' })} size="sm" variant="ghost">
                Show every order
              </ButtonLink>
            ) : null}
            <span className="ml-auto text-xs text-v2-muted">{spanLabel}</span>
          </QueryForm>
          {log.rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-v2-muted">
              Nothing recorded for {first}
              {dated ? ' on these dates' : ''}.
            </p>
          ) : (
            <ol className="divide-y divide-v2-line">
              {log.rows.map((row) => (
                <LogRow key={row.id} row={row} names={log.names} self={row.actor?.id === String(riderId)} />
              ))}
            </ol>
          )}
          <Pagination page={page} pageSize={pageSize} total={log.total} buildHref={(t) => href({}, t)} className="border-t border-v2-line" />
        </TableFrame>
      ) : null}
    </div>
  )
}

function Stat({ label, value, note, warm }: { label: string; value: string; note: string; warm?: boolean }) {
  return (
    <div className="grid gap-2 rounded-v2-lg border border-v2-line bg-v2-surface p-[18px] first:col-span-2 sm:first:col-span-1">
      <span className="text-[13px] font-semibold text-v2-ink-2">{label}</span>
      <span className={cx('truncate text-[34px] font-bold leading-none tracking-[-0.04em] tabular-nums', warm && 'text-v2-cod')}>{value}</span>
      <span className="text-[12.5px] text-v2-muted">{note}</span>
    </div>
  )
}

/** One line of the rider's event log: time, what happened, which order, who. */
function LogRow({ row, names, self }: { row: ActivityEntry; names: Map<string, string>; self: boolean }) {
  const { detail, reason } = row.type === 'event' ? eventDetail(row, names) : { detail: null, reason: null }
  const action = typeof row.meta?.action === 'string' ? row.meta.action : null
  const who = row.actor ? `${row.actor.name} · ${ROLE_LABEL[row.actor.role as Role] ?? row.actor.role}` : 'System'
  const from = row.fromStatus ? statusChip(row.fromStatus) : null
  const to = statusChip(row.toStatus)
  return (
    <li className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 px-4 py-2.5 text-sm">
      <Mono className="pt-0.5 text-xs text-v2-faint">
        {formatShortDate(row.at.toISOString().slice(0, 10))} {formatTimeIST(row.at)}
      </Mono>
      <div className="min-w-0 grid gap-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          {row.type === 'note' ? (
            <Chip tone="info">call note</Chip>
          ) : row.fromStatus === row.toStatus ? (
            <Chip tone="grey">{action === 'FIELD_EDITED' ? 'edited' : action ? action.replace(/_/g, ' ').toLowerCase() : 'updated'}</Chip>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              {from ? (
                <>
                  <Chip tone={from.tone}>{from.label}</Chip>
                  <span className="text-v2-faint">→</span>
                </>
              ) : (
                <span className="text-xs font-semibold text-v2-muted">created</span>
              )}
              <Chip tone={to.tone}>{to.label}</Chip>
            </span>
          )}
          <Link href={`/v2/orders/${row.orderId}`} className={cx('font-mono text-xs font-semibold text-v2-brand underline-offset-2 hover:underline', v2Focus)}>
            {row.externalOrderId}
          </Link>
          <span className="text-xs text-v2-faint">
            {row.stationCode}
            {row.trainNo ? ` · ${row.trainNo}` : ''}
            {row.contactName ? ` · ${row.contactName}` : ''}
          </span>
          {self ? null : <span className="ml-auto text-xs text-v2-muted">{who}</span>}
        </div>
        {row.text ? <p className="text-xs text-v2-ink-2">&ldquo;{row.text}&rdquo;</p> : null}
        {detail ? <p className="text-xs text-v2-ink-2">{detail}</p> : null}
        {reason ? <p className="text-xs text-v2-muted">&ldquo;{reason}&rdquo;</p> : null}
      </div>
    </li>
  )
}
