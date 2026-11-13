import Link from 'next/link'
import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { findMany } from '@/lib/repo/orderRepo'
import { analyticsMatch, codSummary, countOrdersBy, countOverdueOpen } from '@/lib/repo/analyticsRepo'
import { orderFilterOptions } from '@/lib/repo/orderFilters'
import { riderNamesFor } from '@/lib/repo/riderFilter'
import {
  DIMENSIONS, DIMENSION_LABEL, NO_OUTLET, NO_PAYMENT, NO_RIDER, OUTCOMES, OUTCOME_LABEL,
  analyticsParams, buildSeries, hasAnalyticsFilters, isOutcome, readAnalyticsFilters, share, tallyAll, tallyByKey,
  type Outcome, type Tally,
} from '@/lib/analytics'
import { ORDER_SOURCES, PAYMENT_MODES, sourceLabel } from '@/lib/orderEnums'
import { ORDER_STATUSES } from '@/lib/orderStatus'
import { formatDateRange, formatRupees, formatServiceDate, formatShortDate } from '@/lib/format'
import {
  ButtonAnchor, ButtonLink, Card, Dash, EmptyState, PageHeader, Pagination, PaymentBadge, StatusBadge,
  PAGE_SIZE_OPTIONS, focusRing, segmentClass, segmentedClass, statusLabel, thClass,
} from '@/components/ui'
import { IconClose, IconDownload } from '@/components/Icons'
import { QueryForm } from '@/components/QueryForm'
import { DateFilter } from '@/components/DateFilter'
import { AutoSelect } from './AutoSelect'
import { OrdersChart } from './OrdersChart'
import { OUTCOME_FILL } from './outcomeStyle'

export const metadata = { title: 'Analytics · RailServe' }

const DEFAULT_PAGE_SIZE = 20
const DEFAULT_GROUP_PAGE_SIZE = 10

const PAYMENT_LABEL: Record<string, string> = { COD: 'Cash on delivery', PREPAID: 'Prepaid', INVOICE: 'Invoice' }

/**
 * Analytics: how the orders in a date range turned out, and where.
 *
 * Four things, top to bottom, each narrower than the last: the outcome
 * figures, one chart over time, a ranked breakdown (by outlet, station,
 * aggregator, payment, status or day), and, once an outlet or a status is
 * picked, the orders themselves with their cash. Every figure reads the
 * filters in the URL, and so does the export, so a report is whatever is on
 * screen rather than something rebuilt on another page.
 */
export default async function AnalyticsPage(props: PageProps<'/admin/analytics'>) {
  const ctx = await requireRole('ADMIN')
  const sp = await props.searchParams
  let f = readAnalyticsFilters(sp)

  await connectDb()
  const options = await orderFilterOptions(ctx, f.stations)
  // With a station picked, only its outlets are on offer. An outlet carried
  // over from before the station changed is dropped rather than left to
  // filter the page down to nothing.
  const outletChoices = f.stations.length
    ? options.outlets.filter((o) => f.stations.includes(o.stationCode))
    : options.outlets
  if (f.outlet && f.outlet !== NO_OUTLET && f.stations.length && !outletChoices.some((o) => o.id === f.outlet)) {
    f = readAnalyticsFilters({ ...sp, outlet: undefined })
  }

  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''
  const positive = (raw: string) => {
    const n = Number.parseInt(raw, 10)
    return Number.isFinite(n) && n > 0 ? n : 1
  }
  const sizeOf = (raw: string, fallback: number) => {
    const n = Number.parseInt(raw, 10)
    return (PAGE_SIZE_OPTIONS as readonly number[]).includes(n) ? n : fallback
  }
  const pageSize = sizeOf(one(sp.pageSize), DEFAULT_PAGE_SIZE)
  const groupPageSize = sizeOf(one(sp.bps), DEFAULT_GROUP_PAGE_SIZE)

  // The figures at the top count every status, so picking one does not blank
  // the rest; everything below them reads the status filter too.
  const matchAnyStatus = analyticsMatch(f, { status: false })
  const match = analyticsMatch(f)
  // The orders themselves appear once the view has been narrowed to
  // something a person would want to read row by row.
  const showOrders = Boolean(f.outlet || f.status || f.rider)

  const [statusRows, dayRows, groupRows, overdue, cod] = await Promise.all([
    countOrdersBy(ctx, matchAnyStatus, null),
    countOrdersBy(ctx, match, 'day'),
    f.by === 'day' ? null : countOrdersBy(ctx, match, f.by),
    countOverdueOpen(ctx, matchAnyStatus),
    showOrders ? codSummary(ctx, match) : null,
  ])

  const overview = tallyAll(statusRows)
  const inView = tallyAll(dayRows)
  const { granularity, buckets } = buildSeries(dayRows, f.from, f.to)

  // Clamped, so a filter changed on page 4 of a longer list lands on a real page.
  const page = Math.min(positive(one(sp.page)), Math.max(1, Math.ceil(inView.total / pageSize)))
  const orders = showOrders
    ? await findMany(ctx, match, { sort: { serviceDate: -1, createdAt: -1 }, limit: pageSize, skip: (page - 1) * pageSize })
    : []
  const riderName = await riderNamesFor(orders)

  const outletName = new Map(options.outlets.map((o) => [o.id, `${o.name} · ${o.stationCode}`]))
  const stationName = new Map(options.stations.map((s) => [s.code, s.name]))
  const riderLabel = new Map(options.riders.map((r) => [r.id, r.active ? r.name : `${r.name} (inactive)`]))
  const pickedOutlet =
    f.outlet === NO_OUTLET ? 'Unassigned orders' : f.outlet ? (outletName.get(f.outlet) ?? 'Unknown outlet') : null

  const href = (over: Parameters<typeof analyticsParams>[1] = {}, extra: Record<string, string> = {}) => {
    const u = analyticsParams(f, over)
    for (const [k, v] of Object.entries(extra)) if (v) u.set(k, v)
    const qs = u.toString()
    return `/admin/analytics${qs ? `?${qs}` : ''}`
  }
  const exportHref = (report: 'orders' | 'summary') => {
    const u = analyticsParams(f, { by: f.by })
    u.set('report', report)
    return `/admin/analytics/export?${u}`
  }

  /* ── the breakdown ────────────────────────────────────────────────────── */

  const groups = tallyByKey(groupRows ?? dayRows)
  if (f.by === 'day') groups.sort((a, b) => String(b.key).localeCompare(String(a.key)))
  if (f.by === 'status') {
    const at = (s: string | null) => {
      const i = (ORDER_STATUSES as readonly string[]).indexOf(s ?? '')
      return i === -1 ? ORDER_STATUSES.length : i
    }
    groups.sort((a, b) => at(a.key) - at(b.key))
  }
  const groupPage = Math.min(positive(one(sp.bp)), Math.max(1, Math.ceil(groups.length / groupPageSize)))
  const groupSlice = groups.slice((groupPage - 1) * groupPageSize, groupPage * groupPageSize)
  const groupPeak = Math.max(1, ...groups.map((g) => g.total))

  const groupName = (key: string | null): string => {
    switch (f.by) {
      case 'outlet': return key ? (outletName.get(key) ?? 'Unknown outlet') : 'Unassigned'
      case 'station': return key ? (stationName.get(key) ? `${key} · ${stationName.get(key)}` : key) : 'No station'
      case 'source': return sourceLabel(key)
      case 'payment': return key ? (PAYMENT_LABEL[key] ?? key) : 'Not recorded'
      case 'rider': return key ? (riderLabel.get(key) ?? 'Unknown rider') : 'No rider'
      case 'status': return key ? statusLabel(key) : 'No status'
      case 'day': return key ? formatServiceDate(key) : 'No date'
    }
  }
  // A row narrows the view to itself. `by` is dropped so the breakdown moves
  // on to the next dimension still worth comparing.
  const groupHref = (key: string | null): string => {
    switch (f.by) {
      case 'outlet': return href({ outlet: key ?? NO_OUTLET, by: '' })
      case 'station': return key ? href({ stations: [key], by: '' }) : href()
      case 'source': return key ? href({ source: key, by: '' }) : href()
      case 'payment': return href({ payment: key ?? NO_PAYMENT, by: '' })
      case 'rider': return href({ rider: key ?? NO_RIDER, by: '' })
      case 'status': return key ? href({ status: key, by: '' }) : href()
      case 'day': return key ? href({ mode: 'range', from: key, to: key, by: '' }) : href()
    }
  }

  const filtered = hasAnalyticsFilters(f)
  const plural = (n: number, word: string) => `${n.toLocaleString('en-IN')} ${word}${n === 1 ? '' : 's'}`

  return (
    <div className="space-y-5">
      <PageHeader
        title={pickedOutlet ?? 'Analytics'}
        back={pickedOutlet ? { href: href({ outlet: '', by: '' }), label: 'All outlets' } : undefined}
        note={formatDateRange(f.from, f.to)}
        action={
          <ButtonAnchor href={exportHref('orders')} download>
            <IconDownload size={15} />
            Export CSV
          </ButtonAnchor>
        }
      />

      {/* One quiet toolbar: every control applies as it changes. */}
      <QueryForm
        key={analyticsParams(f).toString()}
        action="/admin/analytics"
        className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center"
      >
        {f.bySet ? <input type="hidden" name="by" value={f.by} /> : null}
        {f.status ? <input type="hidden" name="status" value={f.status} /> : null}
        <DateFilter mode={f.mode} month={f.month} from={f.rawFrom} to={f.rawTo} autoSubmit />
        <div className="grid grid-cols-2 gap-2 lg:ml-auto lg:flex lg:flex-wrap">
          <AutoSelect name="outlet" defaultValue={f.outlet} aria-label="Outlet">
            <option value="">All outlets</option>
            {outletChoices.map((o) => (
              <option key={o.id} value={o.id}>{o.name} · {o.stationCode}</option>
            ))}
            <option value={NO_OUTLET}>Unassigned</option>
          </AutoSelect>
          <AutoSelect name="station" defaultValue={f.stations[0] ?? ''} aria-label="Station">
            <option value="">All stations</option>
            {options.stations.map((s) => (
              <option key={s.code} value={s.code}>{s.name ? `${s.code} · ${s.name}` : s.code}</option>
            ))}
          </AutoSelect>
          <AutoSelect name="source" defaultValue={f.source} aria-label="Aggregator">
            <option value="">All aggregators</option>
            {ORDER_SOURCES.map((s) => (
              <option key={s} value={s}>{sourceLabel(s)}</option>
            ))}
          </AutoSelect>
          <AutoSelect name="rider" defaultValue={f.rider} aria-label="Rider">
            <option value="">All riders</option>
            <option value={NO_RIDER}>No rider</option>
            {options.riders.map((r) => (
              <option key={r.id} value={r.id}>{r.name}{r.active ? '' : ' (inactive)'}</option>
            ))}
          </AutoSelect>
          <AutoSelect name="payment" defaultValue={f.payment} aria-label="Payment mode">
            <option value="">Any payment</option>
            {PAYMENT_MODES.map((p) => (
              <option key={p} value={p}>{PAYMENT_LABEL[p]}</option>
            ))}
          </AutoSelect>
        </div>
        {f.status && !isOutcome(f.status) ? (
          <Link
            href={href({ status: '' })}
            scroll={false}
            className={`inline-flex h-9 items-center gap-1.5 self-start rounded-lg bg-accent-soft px-3 text-sm font-medium text-accent ${focusRing}`}
          >
            Status: {statusLabel(f.status)}
            <IconClose size={14} aria-label="Remove" />
          </Link>
        ) : null}
        {filtered ? (
          <ButtonLink href="/admin/analytics" variant="ghost" className="self-start">Reset</ButtonLink>
        ) : null}
      </QueryForm>

      {/* ── outcomes: the figures, and the way to filter to one ─────────── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Figure
          href={href({ status: '' })}
          active={!f.status}
          label="Orders"
          value={overview.total}
          amount={formatRupees(overview.amountPaise)}
          note="billed"
          className="col-span-2 md:col-span-1"
        />
        {(['delivered', 'progress', 'undelivered', 'cancelled'] as const).map((o) => (
          <Figure
            key={o}
            href={href({ status: f.status === o ? '' : o })}
            active={f.status === o}
            outcome={o}
            label={OUTCOME_LABEL[o]}
            value={overview.counts[o]}
            amount={formatRupees(overview.amounts[o])}
            note={
              o === 'progress' && overdue > 0
                ? `${overdue} past arrival`
                : `${share(overview.counts[o], overview.total)} of orders`
            }
            warn={o === 'progress' && overdue > 0}
          />
        ))}
      </div>

      {inView.total === 0 ? (
        <EmptyState
          title="No orders match"
          note={
            f.status && overview.total > 0
              ? 'Nothing in this range has that status. Pick another figure above.'
              : 'Try a wider date range, or reset the filters.'
          }
          action={filtered ? <ButtonLink href="/admin/analytics">Reset filters</ButtonLink> : undefined}
        />
      ) : (
        <>
          {/* ── the chart ──────────────────────────────────────────────── */}
          <Card className="p-5">
            <OrdersChart
              buckets={buckets}
              unit={granularity}
              heading={plural(inView.total, 'order')}
              sub={`${f.status ? `${filterLabel(f.status)} · ` : ''}per ${granularity}`}
            />
          </Card>

          {/* ── the breakdown ──────────────────────────────────────────── */}
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
              <h2 className="text-sm font-semibold text-ink">Breakdown</h2>
              <div className="flex max-w-full items-center gap-2">
                <div className={`${segmentedClass} max-w-full flex-nowrap overflow-x-auto [scrollbar-width:none]`}>
                  {DIMENSIONS.map((d) => (
                    <Link
                      key={d}
                      href={href({ by: d })}
                      scroll={false}
                      aria-current={f.by === d ? 'true' : undefined}
                      className={segmentClass(f.by === d)}
                    >
                      {DIMENSION_LABEL[d]}
                    </Link>
                  ))}
                </div>
                <ButtonAnchor
                  href={exportHref('summary')}
                  download
                  variant="ghost"
                  className="shrink-0 px-2.5"
                  aria-label="Export this breakdown as CSV"
                  title="Export this breakdown as CSV"
                >
                  <IconDownload size={15} />
                </ButtonAnchor>
              </div>
            </div>
            <ul className="mt-2 divide-y divide-line">
              {groupSlice.map((g) => (
                <GroupRow
                  key={g.key ?? 'none'}
                  tally={g}
                  peak={groupPeak}
                  name={groupName(g.key)}
                  href={groupHref(g.key)}
                  showShare={f.by !== 'status'}
                />
              ))}
            </ul>
            {f.by === 'rider' ? (
              <p className="border-t border-line px-5 py-2.5 text-xs text-muted">
                An order shared by two riders counts for each of them here, so rows can add up to more than the total.
              </p>
            ) : null}
            {groups.length > DEFAULT_GROUP_PAGE_SIZE ? (
              <div className="border-t border-line">
                <Pagination
                  page={groupPage}
                  pageSize={groupPageSize}
                  total={groups.length}
                  buildHref={({ page: p, pageSize: ps }) =>
                    href({}, {
                      bp: p > 1 ? String(p) : '',
                      bps: ps !== DEFAULT_GROUP_PAGE_SIZE ? String(ps) : '',
                    })
                  }
                />
              </div>
            ) : null}
          </Card>

          {/* ── the orders, once the view is narrow enough to read ─────── */}
          {showOrders && cod ? (
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 px-5 py-4">
                <div>
                  <h2 className="text-sm font-semibold text-ink">Orders</h2>
                  <p className="mt-0.5 text-xs text-muted">
                    {[
                      pickedOutlet,
                      f.rider ? (f.rider === NO_RIDER ? 'No rider' : (riderLabel.get(f.rider) ?? 'Unknown rider')) : null,
                      f.status ? filterLabel(f.status) : null,
                      plural(inView.total, 'order'),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                {/* Where the cash stands, in one line rather than a second row of tiles. */}
                {cod.orders > 0 ? (
                  <dl className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
                    <Cash label="COD orders" value={String(cod.orders)} />
                    <Cash label="COD collected" value={formatRupees(cod.collectedPaise)} />
                    <Cash label="Handed to store" value={formatRupees(cod.settledPaise)} />
                    <Cash label="With riders" value={formatRupees(cod.pendingPaise)} warn={cod.pendingPaise > 0} />
                  </dl>
                ) : null}
              </div>
              <div className="overflow-x-auto border-t border-line">
                <table className="w-full min-w-[58rem] text-sm">
                  <thead className="border-b border-line bg-sunken/60">
                    <tr>
                      <th className={thClass}>Order</th>
                      <th className={thClass}>Date</th>
                      <th className={thClass}>Status</th>
                      {f.outlet ? null : <th className={thClass}>Outlet</th>}
                      <th className={thClass}>Aggregator</th>
                      <th className={thClass}>Passenger</th>
                      <th className={`${thClass} text-right`}>Amount</th>
                      <th className={thClass}>Payment</th>
                      <th className={thClass}>COD cash</th>
                      <th className={thClass}>Rider</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {orders.map((o) => {
                      const isCod = o.paymentMode === 'COD'
                      const cash = o.delivery?.amountCollectedPaise ?? o.amountPaise
                      return (
                        <tr key={String(o._id)} className="transition-colors hover:bg-sunken/60">
                          <td className="px-3 py-2.5">
                            <Link
                              href={`/admin/orders/${String(o._id)}`}
                              className={`whitespace-nowrap rounded font-mono text-[13px] font-medium text-accent hover:underline ${focusRing}`}
                            >
                              {o.externalOrderId}
                            </Link>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-muted" title={formatServiceDate(o.serviceDate)}>
                            {formatShortDate(o.serviceDate)}
                          </td>
                          <td className="px-3 py-2.5"><StatusBadge status={o.status} /></td>
                          {f.outlet ? null : (
                            <td className="max-w-[14rem] truncate px-3 py-2.5 text-muted">
                              {outletName.get(String(o.restaurantId)) ?? <Dash />}
                            </td>
                          )}
                          <td className="whitespace-nowrap px-3 py-2.5 text-muted">{sourceLabel(o.source)}</td>
                          <td className="max-w-[12rem] truncate px-3 py-2.5 text-muted">{o.contactName ?? <Dash />}</td>
                          <td className="px-3 py-2.5 text-right font-medium tabular-nums text-ink">
                            {formatRupees(o.amountPaise)}
                          </td>
                          <td className="px-3 py-2.5"><PaymentBadge mode={o.paymentMode} /></td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-muted">
                            {!isCod ? (
                              <Dash />
                            ) : o.status !== 'DELIVERED' ? (
                              <span className="text-faint">Not collected</span>
                            ) : (
                              <>
                                <span className="font-medium tabular-nums text-ink">{formatRupees(cash)}</span>{' '}
                                {o.delivery?.codSettledAt ? 'handed to store' : 'with rider'}
                              </>
                            )}
                          </td>
                          <td className="max-w-[10rem] truncate px-3 py-2.5 text-muted">
                            {riderName.get(String(o._id)) || <Dash />}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-line">
                <Pagination
                  page={page}
                  pageSize={pageSize}
                  total={inView.total}
                  buildHref={({ page: p, pageSize: ps }) =>
                    href({}, {
                      page: p > 1 ? String(p) : '',
                      pageSize: ps !== DEFAULT_PAGE_SIZE ? String(ps) : '',
                      bp: groupPage > 1 ? String(groupPage) : '',
                      bps: groupPageSize !== DEFAULT_GROUP_PAGE_SIZE ? String(groupPageSize) : '',
                    })
                  }
                />
              </div>
            </Card>
          ) : null}
        </>
      )}
    </div>
  )
}

/** An outcome key or an exact status, as words. */
function filterLabel(status: string): string {
  return (OUTCOME_LABEL as Record<string, string>)[status] ?? statusLabel(status)
}

/**
 * One headline figure, and the control that filters to it. Pressing the
 * active one again clears it. The dot is the colour the outcome wears in the
 * chart and the breakdown, so the figures double as their key.
 */
function Figure({
  href, active, outcome, label, value, amount, note, warn = false, className = '',
}: {
  href: string
  active: boolean
  outcome?: Outcome
  label: string
  value: number
  /** The bill value of these orders, already formatted. */
  amount: string
  note: string
  warn?: boolean
  className?: string
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? 'true' : undefined}
      className={`rounded-xl border bg-surface px-4 py-3.5 transition-colors ${focusRing} ${
        active ? 'border-accent ring-1 ring-accent' : 'border-line hover:border-line-strong'
      } ${className}`}
    >
      <div className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
        {outcome ? (
          <span className="size-2 rounded-full" style={{ background: OUTCOME_FILL[outcome] }} aria-hidden />
        ) : null}
        {label}
      </div>
      <div className="mt-1 text-[28px] font-semibold leading-9 tracking-tight text-ink">
        {value.toLocaleString('en-IN')}
      </div>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-xs">
        <span className="text-sm font-semibold text-ink">{amount}</span>
        <span className={warn ? 'font-medium text-amber-700' : 'text-faint'}>{note}</span>
      </div>
    </Link>
  )
}

function Cash({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <dt className="text-faint">{label}</dt>
      <dd className={`mt-0.5 text-sm font-semibold tabular-nums ${warn ? 'text-amber-700' : 'text-ink'}`}>{value}</dd>
    </div>
  )
}

/**
 * One line of the breakdown: a name, a bar as long as the group is busy and
 * split by how its orders turned out, then the three numbers worth a column.
 * The whole line is the link that narrows the page to it.
 */
function GroupRow({
  tally: t, peak, name, href, showShare,
}: {
  tally: Tally
  peak: number
  name: string
  href: string
  /** Off when the rows are statuses: a status is 0% or 100% delivered by definition. */
  showShare: boolean
}) {
  const parts = OUTCOMES.filter((o) => t.counts[o] > 0)
  return (
    <li>
      <Link
        href={href}
        className={`grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 px-5 py-3 transition-colors hover:bg-sunken/60 sm:grid-cols-[minmax(0,14rem)_1fr_auto] ${focusRing} focus-visible:ring-inset focus-visible:ring-offset-0`}
      >
        <span className="truncate text-sm font-medium text-ink">{name}</span>
        <span
          className="order-last col-span-2 flex h-2 sm:order-none sm:col-span-1"
          role="img"
          aria-label={parts.map((o) => `${t.counts[o]} ${OUTCOME_LABEL[o].toLowerCase()}`).join(', ')}
        >
          <span
            className="flex h-full min-w-1.5 gap-0.5 overflow-hidden rounded-full"
            style={{ width: `${(t.total / peak) * 100}%` }}
          >
            {parts.map((o) => (
              <span key={o} style={{ flex: `${t.counts[o]} 1 0`, background: OUTCOME_FILL[o] }} />
            ))}
          </span>
        </span>
        <span className="flex items-baseline gap-4 text-right text-sm tabular-nums">
          <span className="w-10 font-semibold text-ink">{t.total.toLocaleString('en-IN')}</span>
          {showShare ? (
            <span className="hidden w-28 whitespace-nowrap text-muted md:inline">
              {share(t.counts.delivered, t.total)} delivered
            </span>
          ) : null}
          <span className="w-16 text-muted" title="Delivered value">{formatRupees(t.deliveredPaise)}</span>
        </span>
      </Link>
    </li>
  )
}
