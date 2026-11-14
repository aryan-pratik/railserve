import Link from 'next/link'
import mongoose from 'mongoose'
import { notFound } from 'next/navigation'
import type { QueryFilter } from 'mongoose'
import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { Restaurant, RiderLocation, User, type OrderDoc } from '@/lib/models'
import { countOrders, findMany } from '@/lib/repo/orderRepo'
import { activityFeed } from '@/lib/repo/activityRepo'
import { onClosedRecord, onRiderRecord } from '@/lib/repo/orderRepo'
import {
  NO_RIDER_DAY, NO_RIDER_NOW, closedBetween, opsSpan, riderDays, riderDoneFilter, ridersNow,
} from '@/lib/repo/riderLedgerRepo'
import { collectionHistory, pendingCashFor, receiversOf } from '@/lib/repo/riderCashRepo'
import { opsDayOf } from '@/lib/opsDay'
import { OVERALL_LABEL, RIDER_LABEL, overallStatus, riderStatus } from '@/lib/orderViews'
import { resolveDateRange, type DateFilterMode } from '@/lib/dateFilter'
import { formatDateRange, formatIST, formatRupees, formatShortDate, shiftServiceDate } from '@/lib/format'
import { readPage, withPage } from '@/lib/pagination'
import { PRESENCE_LABEL, ageLabel, presenceOf } from '@/lib/riderLocation'
import { TERMINAL_STATUSES } from '@/lib/orderStatus'
import { ActivityList } from '@/components/ActivityList'
import { DateFilter } from '@/components/DateFilter'
import { IconPhone } from '@/components/Icons'
import {
  ButtonLink, Card, Dash, EmptyState, InlineField, PageHeader, Pagination, PaymentBadge, Stat, StatStrip,
  StatusBadge, Tabs, focusRing, segmentClass, segmentedClass, thClass,
} from '@/components/ui'

export const metadata = { title: 'Rider · RailServe' }

/**
 * Where a rider's orders are, grouped the way someone asks about them: still
 * at the counter, in their hands, handed over, not handed over, called off.
 *
 * The first two are about now and are not bounded by the dates picked; the
 * last three are what the rider finished inside those dates. Together they
 * are the same record the rider's own app shows, read from the same ledger.
 */
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

/**
 * When the order closed: the stamp where there is one, otherwise the first
 * event that took it to a closing status — orders closed before the stamp
 * existed have only that.
 */
function closedAt(order: OrderDoc): Date | null {
  const d = order.delivery as Delivery | undefined
  if (d?.closedAt) return d.closedAt
  if (order.status === 'DELIVERED' && d?.deliveredAt) return d.deliveredAt
  const closing = order.events.find((e) => (TERMINAL_STATUSES as readonly string[]).includes(e.toStatus))
  return closing?.createdAt ?? null
}

/**
 * One rider's record: every order they were on, and everything they did.
 *
 * Everything here is the rider ledger (riderLedgerRepo): the orders this
 * rider picked up, or was given and nobody has picked up yet, placed in the
 * 3am-to-3am reporting day in which each one closed. It is the same source,
 * the same day and the same figures as the rider's own app and the Riders
 * board, so the three can be read against each other line by line.
 *
 * The event log is the rider's slice of the activity log: their own actions
 * from the app or the web page, and what others did to their deliveries.
 */
export default async function RiderDetailPage(props: PageProps<'/admin/riders/[id]'>) {
  const ctx = await requireRole('ADMIN')
  const { id } = await props.params
  if (!mongoose.isValidObjectId(id)) notFound()

  await connectDb()
  // Inactive riders open too: history is exactly where someone asks what a
  // rider who has since left carried.
  const rider = await User.findById(id)
    .select('name phone role active restaurantIds isTeamLead teamLeadId canReceiveCash')
    .lean()
  if (!rider || rider.role !== 'DELIVERY_AGENT') notFound()
  const riderId = rider._id

  const sp = await props.searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''
  const tabParam = one(sp.tab)
  const tab = tabParam === 'log' ? 'log' : tabParam === 'cash' ? 'cash' : 'orders'
  const bucketParam = one(sp.status)
  const bucket = bucketParam in BUCKETS ? (bucketParam as Bucket) : null
  const orderTerm = one(sp.order).trim()
  // Opens on today, like every other dated screen.
  const mode = (one(sp.mode) || 'today') as DateFilterMode
  const month = one(sp.month)
  const rawFrom = one(sp.from)
  const rawTo = one(sp.to)
  const { page, pageSize, skip } = readPage(sp)

  // The dates picked are reporting days. "Today" before 3am is still the day
  // that began yesterday at 3am, which is the whole point of the boundary.
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
  // Live orders are "right now", so a range that ended before today has
  // none: the chips read 0 there, and the list behind them must be empty too.
  const live = (statuses: string[]): QueryFilter<OrderDoc> =>
    includesNow ? { $and: [mine, { status: { $in: statuses } }] } : { _id: { $exists: false } }
  const BUCKET_FILTER: Record<Bucket, QueryFilter<OrderDoc>> = {
    waiting: live(WAITING),
    'on-the-way': live(['DISPATCHED']),
    delivered: finished({ status: 'DELIVERED' }),
    'not-delivered': finished({ status: { $in: NOT_DELIVERED } }),
    cancelled: finished({ status: { $nin: ['DELIVERED', ...NOT_DELIVERED] } }),
  }
  const listFilter: QueryFilter<OrderDoc> = bucket
    ? BUCKET_FILTER[bucket]
    : includesNow
      ? { $or: [finished(), live([...WAITING, 'DISPATCHED'])] }
      : finished()

  const logRange = dated ? span : null

  const [days, nows, due, collections, collectedInSpan, orders, listed, log, location, outlets, lead, team] = await Promise.all([
    riderDays(ctx, [riderId], span),
    ridersNow(ctx, [riderId]),
    pendingCashFor(ctx, riderId),
    collectionHistory(ctx, [riderId], { limit: 100 }),
    // Its own query: the newest 100 above say nothing about an older span.
    collectionHistory(ctx, [riderId], { from: span.from, to: span.to, limit: 100_000 }),
    tab === 'orders'
      ? findMany(ctx, listFilter, {
          sort: { 'delivery.closedAt': -1, 'delivery.dispatchedAt': -1, createdAt: -1 },
          skip,
          limit: pageSize,
        })
      : Promise.resolve([]),
    tab === 'orders' ? countOrders(ctx, listFilter) : Promise.resolve(0),
    activityFeed(ctx, {
      range: logRange,
      riderId: String(riderId),
      orderId: tab === 'log' ? orderTerm || null : null,
      skip: tab === 'log' ? skip : 0,
      limit: tab === 'log' ? pageSize : 1,
    }),
    RiderLocation.findOne({ userId: riderId }).select('recordedAt').lean(),
    Restaurant.find({ _id: { $in: rider.restaurantIds ?? [] } }).select('name stationCode').sort({ name: 1 }).lean(),
    rider.teamLeadId ? User.findById(rider.teamLeadId).select('name').lean() : null,
    rider.isTeamLead ? User.countDocuments({ role: 'DELIVERY_AGENT', teamLeadId: riderId }) : 0,
  ])
  const receivers = await receiversOf(collections)

  const day = days.get(String(riderId)) ?? NO_RIDER_DAY
  const now = includesNow ? (nows.get(String(riderId)) ?? NO_RIDER_NOW) : NO_RIDER_NOW
  const bucketCount: Record<Bucket, number> = {
    waiting: now.waiting,
    'on-the-way': now.inHand,
    delivered: day.delivered,
    'not-delivered': day.notDelivered,
    cancelled: day.cancelled,
  }
  const all = day.done + now.inHand + now.waiting
  const presence = presenceOf(location?.recordedAt ?? null)
  const seen = location?.recordedAt ? `last location ${ageLabel(location.recordedAt)}` : 'has never shared a location'

  // Every filter in play, so tabs, buckets and the pager keep each other.
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
    const qs = (target ? withPage(u, target) : u).toString()
    return `/admin/riders/${id}${qs ? `?${qs}` : ''}`
  }

  const spanLabel = dated ? `${formatDateRange(dateFrom || dateTo, dateTo || today)} · 3am to 3am` : 'All time'

  return (
    <div className="space-y-4">
      <PageHeader
        back={{ href: '/admin/riders', label: 'Riders' }}
        title={rider.name}
        badges={
          rider.active === false ? (
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">Inactive</span>
          ) : (
            <span className="rounded-full bg-sunken px-2 py-0.5 text-xs font-semibold text-muted">
              {PRESENCE_LABEL[presence]}
            </span>
          )
        }
        note={
          <>
            <span className="tabular-nums">{rider.phone}</span>
            {outlets.length ? ` · ${outlets.map((o) => `${o.name} (${o.stationCode})`).join(', ')}` : ''}
            {` · ${seen}.`}
            {rider.isTeamLead
              ? ` Team leader of ${team} rider${team === 1 ? '' : 's'}${rider.canReceiveCash ? ', may receive cash' : ''}.`
              : lead
                ? ` Team: ${lead.name}.`
                : ''}
          </>
        }
        action={
          <>
            {rider.phone ? (
              <ButtonLink href={`tel:${rider.phone}`}>
                <IconPhone size={15} aria-hidden />
                Call
              </ButtonLink>
            ) : null}
            <ButtonLink href={`/admin/setup?tab=staff&edit=${id}`}>Account</ButtonLink>
          </>
        }
      />

      <StatStrip columns={5}>
        <Stat
          label="In hand now"
          value={String(now.inHand)}
          note={`${now.waiting} waiting for pickup${now.stale ? ` · ${now.stale} older, never closed` : ''}${now.inHandCodPaise ? ` · ${formatRupees(now.inHandCodPaise)} COD to collect` : ''}`}
          tone="text-accent"
        />
        <Stat
          label="Finished"
          value={String(day.done)}
          note={`${day.delivered} delivered · ${day.notDelivered} not delivered · ${day.cancelled} cancelled`}
        />
        <Stat
          label="Delivered"
          value={String(day.delivered)}
          note={`${day.codOrders} COD · ${day.prepaidOrders} prepaid · ${formatRupees(day.deliveredPaise)}`}
        />
        <Stat
          label="COD collected"
          value={formatRupees(day.codPaise)}
          note={`${formatRupees(collectedInSpan.reduce((a, c) => a + c.paise, 0))} handed in on these dates`}
        />
        <Stat
          label="COD due now"
          value={formatRupees(due.paise)}
          note={`${due.orders} delivered COD order${due.orders === 1 ? '' : 's'} not yet received · all days`}
          tone={due.paise > 0 ? 'text-amber-700' : undefined}
        />
      </StatStrip>

      <Card className="p-3">
        <InlineField label="Date">
          <DateFilter mode={mode} month={month} from={rawFrom} to={rawTo} allowAll autoSubmit />
        </InlineField>
      </Card>

      <Tabs
        label="Rider record"
        tabs={[
          { href: href({ tab: '', order: '' }), label: 'Orders', count: all, active: tab === 'orders' },
          { href: href({ tab: 'cash', status: '', order: '' }), label: 'Collections', count: collections.length, active: tab === 'cash' },
          { href: href({ tab: 'log', status: '' }), label: 'Event log', count: log.total, active: tab === 'log' },
        ]}
        action={<span className="text-xs text-muted">{spanLabel}</span>}
      />

      {tab === 'orders' ? (
        <>
          <div className={segmentedClass} role="group" aria-label="Where the order ended up">
            <Link href={href({ status: '' })} aria-current={!bucket ? 'true' : undefined} className={segmentClass(!bucket)}>
              All <span className="tabular-nums text-faint">{all}</span>
            </Link>
            {(Object.keys(BUCKETS) as Bucket[]).map((b) => (
              <Link
                key={b}
                href={href({ status: b })}
                aria-current={bucket === b ? 'true' : undefined}
                className={segmentClass(bucket === b)}
              >
                {BUCKETS[b]}{' '}
                <span className="tabular-nums text-faint">{bucketCount[b]}</span>
              </Link>
            ))}
          </div>

          {orders.length === 0 ? (
            <EmptyState
              title={all === 0 ? 'No orders yet' : 'No orders here'}
              note={
                all === 0
                  ? `${rider.name.split(/\s+/)[0]} has not been on any order${dated ? ' on these dates' : ''}.`
                  : 'Nothing in this group on these dates. Pick another group or widen the dates.'
              }
            />
          ) : (
            <Card className="overflow-hidden">
              <RiderOrderTable orders={orders} riderId={String(riderId)} logHref={(o) => href({ tab: 'log', status: '', order: o })} />
              <RiderOrderCards orders={orders} riderId={String(riderId)} logHref={(o) => href({ tab: 'log', status: '', order: o })} />
              <div className="border-t border-line">
                <Pagination page={page} pageSize={pageSize} total={listed} buildHref={(t) => href({}, t)} />
              </div>
            </Card>
          )}
        </>
      ) : tab === 'cash' ? (
        <Card className="overflow-hidden">
          {collections.length === 0 && due.paise === 0 ? (
            <EmptyState
              title="No collections yet"
              note={`Nobody has received cash from ${rider.name.split(/\s+/)[0]} yet.`}
            />
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-canvas">
                <tr>
                  <th className={thClass}>Received</th>
                  <th className={thClass}>Received by</th>
                  <th className={`${thClass} text-right`}>COD orders</th>
                  <th className={`${thClass} text-right`}>Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {due.paise > 0 ? (
                  <tr className="bg-amber-50/60">
                    <td className={`${td} font-medium text-amber-900`}>Not yet received</td>
                    <td className={`${td} text-muted`}>With {rider.name.split(/\s+/)[0]}</td>
                    <td className={`${td} text-right tabular-nums`}>{due.orders}</td>
                    <td className={`${td} text-right font-semibold tabular-nums text-amber-900`}>{formatRupees(due.paise)}</td>
                  </tr>
                ) : null}
                {collections.map((c) => {
                  const by = c.receivedById ? receivers.get(c.receivedById) : null
                  return (
                    <tr key={c.id}>
                      <td className={`${td} tabular-nums text-ink`}>{formatIST(c.at)}</td>
                      <td className={td}>
                        {by ? (
                          <>
                            <span className="text-ink">{by.name}</span>
                            <span className="ml-1.5 text-xs text-faint">{by.label}</span>
                          </>
                        ) : (
                          <Dash />
                        )}
                      </td>
                      <td className={`${td} text-right tabular-nums`}>{c.orders}</td>
                      <td className={`${td} text-right font-medium tabular-nums text-emerald-800`}>{formatRupees(c.paise)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {orderTerm ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5 text-sm">
              <span className="text-muted">
                Order <span className="font-mono font-medium text-ink">{orderTerm}</span> only
              </span>
              <Link href={href({ order: '' })} className={`rounded text-sm font-medium text-accent hover:underline ${focusRing}`}>
                Show every order
              </Link>
            </div>
          ) : null}
          <ActivityList
            rows={log.rows}
            names={log.names}
            actorId={String(riderId)}
            emptyNote={`Nothing recorded for ${rider.name.split(/\s+/)[0]}${dated ? ' on these dates' : ''}.`}
          />
          {log.total > 0 ? (
            <div className="border-t border-line">
              <Pagination page={page} pageSize={pageSize} total={log.total} buildHref={(t) => href({}, t)} />
            </div>
          ) : null}
        </Card>
      )}
    </div>
  )
}

type OrderListProps = {
  orders: OrderDoc[]
  riderId: string
  logHref: (externalOrderId: string) => string
}

/** "With rider", "Handed in 3:10 pm": where a COD order's cash is. Null when there is no cash. */
function cashState(order: OrderDoc): { amount: string; state: string; settled: boolean } | null {
  if (order.paymentMode !== 'COD') return null
  const d = order.delivery as Delivery | undefined
  const amount = formatRupees(d?.amountCollectedPaise ?? order.amountPaise)
  if (order.status === 'DISPATCHED') return { amount, state: 'To collect', settled: false }
  if (order.status !== 'DELIVERED') return { amount, state: 'Not collected', settled: false }
  if (d?.codSettledAt) return { amount, state: `Handed in ${formatIST(d.codSettledAt)}`, settled: true }
  return { amount, state: 'With rider', settled: false }
}

/** Shared by others on a bulk handover. */
function sharedWith(order: OrderDoc, riderId: string): number {
  return (order.delivery?.agentIds ?? []).filter((a) => String(a) !== riderId).length
}

function Outcome({ order }: { order: OrderDoc }) {
  const d = order.delivery as Delivery | undefined
  const closed = closedAt(order)
  return (
    <div className="space-y-0.5">
      <StatusBadge status={order.status} />
      <p className="text-xs text-muted">
        {OVERALL_LABEL[overallStatus(order.status)]} · {RIDER_LABEL[riderStatus(order)]}
      </p>
      {closed ? <p className="text-xs text-muted tabular-nums">{formatIST(closed)}</p> : null}
      {d?.proofType && order.status === 'DELIVERED' ? (
        <p className="text-xs text-faint">Proof: {d.proofType.toLowerCase()}</p>
      ) : null}
      {d?.failureReason && order.status !== 'DELIVERED' ? (
        <p title={d.failureReason} className="truncate text-xs text-red-700">{d.failureReason}</p>
      ) : null}
    </div>
  )
}

const td = 'px-3 py-3 align-top'

function RiderOrderTable({ orders, riderId, logHref }: OrderListProps) {
  return (
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full min-w-[56rem] table-fixed text-sm">
        <colgroup>
          <col className="w-[17%]" />
          <col className="w-[9%]" />
          <col className="w-[13%]" />
          <col className="w-[13%]" />
          <col className="w-[13%]" />
          <col className="w-[17%]" />
          <col className="w-[13%]" />
          <col className="w-[5%]" />
        </colgroup>
        <thead className="border-b border-line bg-canvas">
          <tr>
            <th className={thClass}>Order</th>
            <th className={thClass}>Station</th>
            <th className={thClass}>Payment</th>
            <th className={thClass}>Assigned</th>
            <th className={thClass}>Picked up</th>
            <th className={thClass}>Outcome</th>
            <th className={thClass}>Cash</th>
            <th className={thClass}><span className="sr-only">Log</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {orders.map((o) => {
            const d = o.delivery as Delivery | undefined
            const cash = cashState(o)
            const others = sharedWith(o, riderId)
            return (
              <tr key={String(o._id)} className="hover:bg-canvas">
                <td className={td}>
                  <Link
                    href={`/admin/orders/${o._id}`}
                    className={`rounded font-mono font-medium text-accent hover:underline ${focusRing}`}
                  >
                    {o.externalOrderId}
                  </Link>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {formatShortDate(o.serviceDate)}
                    {o.trainNo ? ` · ${o.trainNo}` : ''}
                    {o.coach ? ` · ${o.coach}${o.berth ? ` ${o.berth}` : ''}` : ''}
                  </p>
                  {o.contactName ? (
                    <p className="truncate text-xs font-medium text-ink" title={o.contactName}>{o.contactName}</p>
                  ) : null}
                  {others > 0 ? <p className="text-xs text-faint">with {others} other rider{others === 1 ? '' : 's'}</p> : null}
                </td>
                <td className={`${td} font-mono text-xs text-ink`}>{o.stationCode}</td>
                <td className={td}>
                  <PaymentBadge mode={o.paymentMode} />
                  <p className="mt-1 text-xs font-medium text-ink tabular-nums">{formatRupees(o.amountPaise)}</p>
                </td>
                <td className={`${td} text-xs text-muted tabular-nums`}>{d?.assignedAt ? formatIST(d.assignedAt) : <Dash />}</td>
                <td className={`${td} text-xs text-ink tabular-nums`}>{d?.dispatchedAt ? formatIST(d.dispatchedAt) : <Dash />}</td>
                <td className={td}><Outcome order={o} /></td>
                <td className={td}>
                  {cash ? (
                    <>
                      <p className="text-xs font-medium text-ink tabular-nums">{cash.amount}</p>
                      <p className={`text-xs ${cash.settled ? 'text-emerald-700' : 'text-muted'}`}>{cash.state}</p>
                    </>
                  ) : (
                    <Dash />
                  )}
                </td>
                <td className={`${td} text-right`}>
                  <Link
                    href={logHref(o.externalOrderId)}
                    className={`rounded text-xs font-medium text-accent hover:underline ${focusRing}`}
                    aria-label={`Event log for ${o.externalOrderId}`}
                  >
                    Log
                  </Link>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** The same orders as cards, for a screen too narrow for the table. */
function RiderOrderCards({ orders, riderId, logHref }: OrderListProps) {
  return (
    <ul className="divide-y divide-line md:hidden">
      {orders.map((o) => {
        const d = o.delivery as Delivery | undefined
        const cash = cashState(o)
        const others = sharedWith(o, riderId)
        return (
          <li key={String(o._id)} className="space-y-2.5 px-4 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={`/admin/orders/${o._id}`}
                  className={`rounded font-mono font-medium text-accent hover:underline ${focusRing}`}
                >
                  {o.externalOrderId}
                </Link>
                <p className="mt-0.5 text-xs text-muted">
                  {formatShortDate(o.serviceDate)} · {o.stationCode}
                  {o.trainNo ? ` · ${o.trainNo}` : ''}
                  {o.contactName ? ` · ${o.contactName}` : ''}
                  {others > 0 ? ` · with ${others} other` : ''}
                </p>
              </div>
              <PaymentBadge mode={o.paymentMode} amount={formatRupees(o.amountPaise)} />
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg bg-canvas px-3 py-2 text-xs">
              <div>
                <dt className="text-faint">Picked up</dt>
                <dd className="text-ink tabular-nums">{d?.dispatchedAt ? formatIST(d.dispatchedAt) : '—'}</dd>
              </div>
              <div>
                <dt className="text-faint">Outcome</dt>
                <dd><Outcome order={o} /></dd>
              </div>
              {cash ? (
                <div className="col-span-2">
                  <dt className="text-faint">Cash</dt>
                  <dd className={cash.settled ? 'text-emerald-700' : 'text-ink'}>
                    <span className="tabular-nums">{cash.amount}</span> · {cash.state}
                  </dd>
                </div>
              ) : null}
            </dl>
            <Link href={logHref(o.externalOrderId)} className={`inline-block rounded text-xs font-medium text-accent hover:underline ${focusRing}`}>
              Event log
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
