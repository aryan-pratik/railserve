import Link from 'next/link'
import { ArrowUpRight, Download } from 'lucide-react'
import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { findMany } from '@/lib/repo/orderRepo'
import { analyticsMatch, codSummary, countOrdersBy, countOverdueOpen } from '@/lib/repo/analyticsRepo'
import { orderFilterOptions } from '@/lib/repo/orderFilters'
import { riderNamesFor } from '@/lib/repo/riderFilter'
import {
  DIMENSIONS, DIMENSION_LABEL, NO_OUTLET, NO_PAYMENT, NO_RIDER, OUTCOMES,
  analyticsParams, buildSeries, isOutcome, share, tallyAll, tallyByKey,
  type Outcome, type Tally,
} from '@/lib/analytics'
import { ORDER_SOURCES, ORDER_TYPES, ORDER_TYPE_LABEL, PAYMENT_MODES, sourceLabel } from '@/lib/orderEnums'
import { ORDER_STATUSES } from '@/lib/orderStatus'
import { formatDateRange, formatRupees, formatServiceDate, formatShortDate, todayIST } from '@/lib/format'
import { OUTCOME_SWATCH, OUTCOME_WORD, analyticsHref, exportHref, hasV2AnalyticsFilters, ordersHref, readBreakdownPaging, readV2AnalyticsFilters, v2AnalyticsParams } from '@/lib/v2/analytics'
import { QueryForm } from '@/components/QueryForm'
import { ButtonLink, Card, Chip, Mono, buttonClass, cx, statusChip } from '@/components/v2/ui'
import { EmptyState, PageHeader, Pagination, PillTabs, Sub, Table, TableFrame, Td, Th, readPaging, rowClass } from '@/components/v2/Table'
import { FilterChip } from '@/components/v2/AnalyticsField'
import { AutoSelect } from '@/components/v2/AnalyticsAutoSelect'
import { DateFilter } from '@/components/v2/AnalyticsDateFilter'
import { AnalyticsChart } from '@/components/v2/AnalyticsChart'

export const metadata = { title: 'Analytics · RailServe' }

const PAYMENT_LABEL: Record<string, string> = { COD: 'Cash on delivery', PREPAID: 'Prepaid', INVOICE: 'Invoice' }

/**
 * Analytics: how the orders in a date range turned out, and where.
 *
 * Top to bottom, each narrower than the last: the outcome figures, one chart
 * over time, a ranked breakdown by one dimension, and, once an outlet, a
 * rider or a status is picked, the orders themselves with their cash. Every
 * figure reads the filters in the URL, and so does the export.
 */
export default async function V2AnalyticsPage(props: PageProps<'/v2/analytics'>) {
  const ctx = await requireRole('ADMIN')
  const sp = await props.searchParams
  let f = readV2AnalyticsFilters(sp)

  await connectDb()
  const options = await orderFilterOptions(ctx, f.stations)
  // With a station picked, only its outlets are on offer. An outlet carried
  // over from before the station changed is dropped rather than left to
  // filter the page down to nothing.
  const outletChoices = f.stations.length ? options.outlets.filter((o) => f.stations.includes(o.stationCode)) : options.outlets
  if (f.outlet && f.outlet !== NO_OUTLET && f.stations.length && !outletChoices.some((o) => o.id === f.outlet)) {
    f = readV2AnalyticsFilters({ ...sp, outlet: undefined })
  }

  const { page: rawPage, pageSize } = readPaging(sp)
  const bk = readBreakdownPaging(sp)

  // The figures at the top count every status, so picking one does not blank
  // the rest; everything below them reads the status filter too.
  const matchAnyStatus = analyticsMatch(f, { status: false })
  const match = analyticsMatch(f)
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

  const page = Math.min(rawPage, Math.max(1, Math.ceil(inView.total / pageSize)))
  const orders = showOrders ? await findMany(ctx, match, { sort: { serviceDate: -1, createdAt: -1 }, limit: pageSize, skip: (page - 1) * pageSize }) : []
  const riderName = await riderNamesFor(orders)

  const outletName = new Map(options.outlets.map((o) => [o.id, `${o.name} · ${o.stationCode}`]))
  const stationName = new Map(options.stations.map((s) => [s.code, s.name]))
  const riderLabel = new Map(options.riders.map((r) => [r.id, r.active ? r.name : `${r.name} (inactive)`]))

  const href = (over: Parameters<typeof analyticsParams>[1] = {}, extra: Record<string, string> = {}) => analyticsHref(f, over, extra)
  const pagerExtra = (t: { page: number; pageSize: number }, b: { page: number; pageSize: number }) => ({
    page: t.page > 1 ? String(t.page) : '',
    pageSize: t.pageSize !== 20 ? String(t.pageSize) : '',
    bp: b.page > 1 ? String(b.page) : '',
    bps: b.pageSize !== 20 ? String(b.pageSize) : '',
  })

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
  const groupPage = Math.min(bk.page, Math.max(1, Math.ceil(groups.length / bk.pageSize)))
  const groupSlice = groups.slice((groupPage - 1) * bk.pageSize, groupPage * bk.pageSize)
  const groupPeak = Math.max(1, ...groups.map((g) => g.total))

  const groupName = (key: string | null): string => {
    switch (f.by) {
      case 'outlet': return key ? (outletName.get(key) ?? 'Unknown outlet') : 'Unassigned'
      case 'station': return key ? (stationName.get(key) ? `${key} · ${stationName.get(key)}` : key) : 'No station'
      case 'source': return sourceLabel(key)
      case 'payment': return key ? (PAYMENT_LABEL[key] ?? key) : 'Not recorded'
      case 'rider': return key ? (riderLabel.get(key) ?? 'Unknown rider') : 'No rider'
      case 'status': return key ? statusChip(key).label : 'No status'
      case 'day': return key ? formatServiceDate(key) : 'No date'
    }
  }
  // A row narrows this page to itself; `by` is dropped so the breakdown moves
  // on to the next dimension still worth comparing.
  const groupOver = (key: string | null): Parameters<typeof analyticsParams>[1] | null => {
    switch (f.by) {
      case 'outlet': return { outlet: key ?? NO_OUTLET, by: '' }
      case 'station': return key ? { stations: [key], by: '' } : null
      case 'source': return key ? { source: key, by: '' } : null
      case 'payment': return { payment: key ?? NO_PAYMENT, by: '' }
      case 'rider': return { rider: key ?? NO_RIDER, by: '' }
      case 'status': return key ? { status: key, by: '' } : null
      case 'day': return key ? { mode: 'range', from: key, to: key, by: '' } : null
    }
  }

  const filtered = hasV2AnalyticsFilters(f)
  const plural = (n: number, word: string) => `${n.toLocaleString('en-IN')} ${word}${n === 1 ? '' : 's'}`
  const today = todayIST()
  const selectedKey = f.from === f.to ? buckets[0]?.key ?? null : buckets.find((b) => b.key <= today && today <= lastDayOf(b, buckets))?.key ?? null

  // Every filter in play as a removable chip, so the view explains itself.
  const chips: { label: string; value: string; href: string }[] = []
  if (f.outlet) chips.push({ label: 'Outlet', value: f.outlet === NO_OUTLET ? 'Unassigned' : (outletName.get(f.outlet) ?? 'Unknown'), href: href({ outlet: '', by: '' }) })
  for (const s of f.stations) chips.push({ label: 'Station', value: s, href: href({ stations: f.stations.filter((x) => x !== s), by: '' }) })
  if (f.source) chips.push({ label: 'Aggregator', value: sourceLabel(f.source), href: href({ source: '', by: '' }) })
  if (f.rider) chips.push({ label: 'Rider', value: f.rider === NO_RIDER ? 'No rider' : (riderLabel.get(f.rider) ?? 'Unknown'), href: href({ rider: '', by: '' }) })
  if (f.payment) chips.push({ label: 'Payment', value: f.payment === NO_PAYMENT ? 'Not recorded' : (PAYMENT_LABEL[f.payment] ?? f.payment), href: href({ payment: '', by: '' }) })
  if (f.type) chips.push({ label: 'Type', value: ORDER_TYPE_LABEL[f.type as keyof typeof ORDER_TYPE_LABEL] ?? f.type, href: href({ type: '' }) })
  if (f.status) chips.push({ label: 'Status', value: filterLabel(f.status), href: href({ status: '' }) })

  return (
    <div className="grid gap-[18px]">
      <PageHeader
        title="Analytics"
        note={`${formatDateRange(f.from, f.to)} · ${plural(overview.total, 'order')} · ${formatRupees(overview.amountPaise)} billed`}
        actions={
          <a href={exportHref(f, 'orders')} download className={buttonClass('secondary')}>
            <Download size={15} strokeWidth={2.2} aria-hidden />
            Export orders CSV
          </a>
        }
      />

      <Card>
        <QueryForm key={v2AnalyticsParams(f).toString()} action="/v2/analytics" className="grid gap-3">
          {f.bySet ? <input type="hidden" name="by" value={f.by} /> : null}
          {f.status ? <input type="hidden" name="status" value={f.status} /> : null}
          <DateFilter mode={f.mode} month={f.month} from={f.rawFrom} to={f.rawTo} autoSubmit />
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-6">
            <AutoSelect
              name="station"
              defaultValue={f.stations[0] ?? ''}
              aria-label="Station"
              options={[{ value: '', label: 'All stations' }, ...options.stations.map((s) => ({ value: s.code, label: s.name ? `${s.code} · ${s.name}` : s.code }))]}
            />
            <AutoSelect
              name="outlet"
              defaultValue={f.outlet}
              aria-label="Outlet"
              options={[
                { value: '', label: 'All outlets' },
                ...outletChoices.map((o) => ({ value: o.id, label: `${o.name} · ${o.stationCode}` })),
                { value: NO_OUTLET, label: 'Unassigned' },
              ]}
            />
            <AutoSelect
              name="source"
              defaultValue={f.source}
              aria-label="Aggregator"
              options={[{ value: '', label: 'All aggregators' }, ...ORDER_SOURCES.map((s) => ({ value: s, label: sourceLabel(s) }))]}
            />
            <AutoSelect
              name="rider"
              defaultValue={f.rider}
              aria-label="Rider"
              options={[
                { value: '', label: 'All riders' },
                { value: NO_RIDER, label: 'No rider' },
                ...options.riders.map((r) => ({ value: r.id, label: `${r.name}${r.active ? '' : ' (inactive)'}` })),
              ]}
            />
            <AutoSelect
              name="payment"
              defaultValue={f.payment}
              aria-label="Payment mode"
              options={[
                { value: '', label: 'Any payment' },
                ...PAYMENT_MODES.map((p) => ({ value: p, label: PAYMENT_LABEL[p] })),
                { value: NO_PAYMENT, label: 'Not recorded' },
              ]}
            />
            <AutoSelect
              name="type"
              defaultValue={f.type}
              aria-label="Order type"
              options={[{ value: '', label: 'Any type' }, ...ORDER_TYPES.map((t) => ({ value: t, label: ORDER_TYPE_LABEL[t] }))]}
            />
          </div>
          {chips.length || filtered ? (
            <div className="flex flex-wrap items-center gap-2">
              {chips.map((c) => (
                <FilterChip key={c.label + c.value} label={c.label} value={c.value} href={c.href} />
              ))}
              {filtered ? (
                <ButtonLink href="/v2/analytics" variant="ghost" size="sm">
                  Reset
                </ButtonLink>
              ) : null}
            </div>
          ) : null}
        </QueryForm>
      </Card>

      {/* ── outcomes: the figures, and the way to filter to one ───────────── */}
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-3 xl:grid-cols-5">
        <Stat
          hero
          label="In progress"
          value={overview.counts.progress.toLocaleString('en-IN')}
          href={href({ status: f.status === 'progress' ? '' : 'progress' })}
          active={f.status === 'progress'}
          className="col-span-2 lg:col-span-1"
        >
          {overdue > 0 ? (
            <>
              <Pill>{overdue}</Pill> past arrival with nobody closing them
            </>
          ) : (
            `${formatRupees(overview.amounts.progress)} still to deliver`
          )}
        </Stat>
        <Stat label="Delivered" value={overview.counts.delivered.toLocaleString('en-IN')} href={href({ status: f.status === 'delivered' ? '' : 'delivered' })} active={f.status === 'delivered'}>
          <Pill>{share(overview.counts.delivered, overview.total)}</Pill> of orders
        </Stat>
        <Stat label="Not delivered" value={overview.counts.undelivered.toLocaleString('en-IN')} href={href({ status: f.status === 'undelivered' ? '' : 'undelivered' })} active={f.status === 'undelivered'}>
          <Pill>{share(overview.counts.undelivered, overview.total)}</Pill> failed, missed or misdelivered
        </Stat>
        <Stat label="Cancelled" value={overview.counts.cancelled.toLocaleString('en-IN')} href={href({ status: f.status === 'cancelled' ? '' : 'cancelled' })} active={f.status === 'cancelled'}>
          <Pill>{share(overview.counts.cancelled, overview.total)}</Pill> cancelled or lost
        </Stat>
        <Stat label="Revenue delivered" value={formatRupees(overview.deliveredPaise)} href={href({ status: 'delivered' })} active={false}>
          of {formatRupees(overview.amountPaise)} billed
          {overview.counts.other > 0 ? ` · ${overview.counts.other} other` : ''}
        </Stat>
      </div>

      {/* The three statuses the business reports by. Not delivered and missed
          deliveries count as cancelled here; the figures above keep them apart. */}
      <p className="-mt-1 text-sm text-v2-muted">
        Overall: <b className="font-semibold text-v2-ink tabular-nums">{overview.overall.PROCESSING}</b> processing ·{' '}
        <b className="font-semibold text-v2-ink tabular-nums">{overview.overall.DELIVERED}</b> delivered ·{' '}
        <b className="font-semibold text-v2-ink tabular-nums">{overview.overall.CANCELLED}</b> cancelled
        <span className="text-v2-faint"> (cancelled includes not delivered and missed)</span>
      </p>

      {inView.total === 0 ? (
        <EmptyState
          title="No orders match"
          note={f.status && overview.total > 0 ? 'Nothing in this range has that status. Pick another figure above.' : 'Try a wider date range, or reset the filters.'}
          action={filtered ? <ButtonLink href="/v2/analytics">Reset filters</ButtonLink> : undefined}
        />
      ) : (
        <>
          {/* ── the chart ──────────────────────────────────────────────────── */}
          <Card
            title={`${plural(inView.total, 'order')} per ${granularity}`}
            action={<Chip tone="grey">{f.status ? filterLabel(f.status) : 'All outcomes'}</Chip>}
          >
            <AnalyticsChart
              buckets={buckets}
              unit={granularity}
              selectedKey={selectedKey}
              hrefFor={(b) => href({ mode: 'range', from: b.key, to: lastDayOf(b, buckets), by: '' })}
            />
          </Card>

          {/* ── the breakdown ──────────────────────────────────────────────── */}
          <Card
            title="Breakdown"
            action={
              <a href={exportHref(f, 'summary')} download className={buttonClass('secondary', 'sm')} title="Export this breakdown as CSV">
                <Download size={14} strokeWidth={2.2} aria-hidden />
                CSV
              </a>
            }
          >
            <PillTabs tabs={DIMENSIONS.map((d) => ({ href: href({ by: d }), label: DIMENSION_LABEL[d], active: f.by === d }))} />
            <TableFrame>
              <Table className="min-w-[60rem]">
                <thead>
                  <tr>
                    <Th>{DIMENSION_LABEL[f.by]}</Th>
                    <Th className="w-[30%]">Mix</Th>
                    <Th align="right">Orders</Th>
                    <Th align="right">Delivered</Th>
                    <Th align="right">In progress</Th>
                    <Th align="right">Not delivered</Th>
                    <Th align="right">Cancelled</Th>
                    <Th align="right">Delivered value</Th>
                    {/* relative keeps the sr-only label inside the scroll box, so it cannot widen the page on a phone. */}
                    <Th className="relative">
                      <span className="sr-only">Orders list</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {groupSlice.map((g) => {
                    const over = groupOver(g.key)
                    const name = groupName(g.key)
                    return (
                      <tr key={g.key ?? 'none'} className={rowClass()}>
                        <Td className="max-w-[16rem] truncate font-semibold">
                          {over ? (
                            <Link href={href(over)} scroll={false} className="hover:text-v2-brand hover:underline">
                              {name}
                            </Link>
                          ) : (
                            name
                          )}
                        </Td>
                        <Td>
                          <MixBar tally={g} peak={groupPeak} />
                        </Td>
                        <Td align="right" className="font-mono font-semibold tabular-nums">{g.total.toLocaleString('en-IN')}</Td>
                        <Td align="right" className="font-mono tabular-nums">
                          {g.counts.delivered}
                          {f.by !== 'status' ? <Sub>{share(g.counts.delivered, g.total)}</Sub> : null}
                        </Td>
                        <Td align="right" className="font-mono tabular-nums text-v2-muted">{g.counts.progress || '–'}</Td>
                        <Td align="right" className="font-mono tabular-nums text-v2-muted">{g.counts.undelivered || '–'}</Td>
                        <Td align="right" className="font-mono tabular-nums text-v2-muted">{g.counts.cancelled || '–'}</Td>
                        <Td align="right" className="font-mono tabular-nums">{formatRupees(g.deliveredPaise)}</Td>
                        <Td align="right">
                          <Link
                            href={over ? ordersHref(f, over) : ordersHref(f)}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-v2-brand hover:underline"
                            title="Open these orders"
                          >
                            Orders
                            <ArrowUpRight size={13} strokeWidth={2.2} aria-hidden />
                          </Link>
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
              <Pagination
                page={groupPage}
                pageSize={bk.pageSize}
                total={groups.length}
                buildHref={(t) => href({}, pagerExtra({ page, pageSize }, t))}
                className="border-t border-v2-line"
              />
            </TableFrame>
            {f.by === 'rider' ? (
              <p className="text-xs text-v2-muted">An order shared by two riders counts for each of them here, so rows can add up to more than the total.</p>
            ) : null}
          </Card>

          {/* ── the orders, once the view is narrow enough to read ─────────── */}
          {showOrders && cod ? (
            <Card title="Orders" action={<ButtonLink href={ordersHref(f)} size="sm">Open in Orders</ButtonLink>}>
              <p className="-mt-2 text-sm text-v2-muted">
                {[chips.map((c) => c.value).join(' · '), plural(inView.total, 'order')].filter(Boolean).join(' · ')}
              </p>
              {cod.orders > 0 ? (
                <dl className="grid grid-cols-2 gap-3 rounded-v2-md bg-v2-cod-bg/60 px-4 py-3 sm:grid-cols-4">
                  <Cash label="COD orders" value={String(cod.orders)} />
                  <Cash label="Collected" value={formatRupees(cod.collectedPaise)} />
                  <Cash label="Handed to store" value={formatRupees(cod.settledPaise)} />
                  <Cash label="With riders" value={formatRupees(cod.pendingPaise)} warm={cod.pendingPaise > 0} />
                </dl>
              ) : null}
              <TableFrame>
                <Table className="min-w-[64rem]">
                  <thead>
                    <tr>
                      <Th>Order</Th>
                      <Th>Date</Th>
                      <Th>Status</Th>
                      {f.outlet ? null : <Th>Outlet</Th>}
                      <Th>Aggregator</Th>
                      <Th>Passenger</Th>
                      <Th align="right">Amount</Th>
                      <Th>Payment</Th>
                      <Th>COD cash</Th>
                      <Th>Rider</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => {
                      const id = String(o._id)
                      const isCod = o.paymentMode === 'COD'
                      const cash = o.delivery?.amountCollectedPaise ?? o.amountPaise
                      const chip = statusChip(o.status)
                      return (
                        <tr key={id} className={rowClass()}>
                          <Td>
                            <Link href={`/v2/orders/${id}`} className="font-mono text-[13px] font-semibold text-v2-brand hover:underline">
                              {o.externalOrderId}
                            </Link>
                          </Td>
                          <Td className="text-v2-muted" title={formatServiceDate(o.serviceDate)}>
                            <Mono>{formatShortDate(o.serviceDate)}</Mono>
                          </Td>
                          <Td>
                            <Chip tone={chip.tone}>{chip.label}</Chip>
                          </Td>
                          {f.outlet ? null : <Td className="max-w-[14rem] truncate text-v2-muted">{outletName.get(String(o.restaurantId)) ?? '–'}</Td>}
                          <Td className="text-v2-muted">{sourceLabel(o.source)}</Td>
                          <Td className="max-w-[12rem] truncate text-v2-muted">{o.contactName ?? '–'}</Td>
                          <Td align="right" className="font-mono font-semibold tabular-nums">{formatRupees(o.amountPaise)}</Td>
                          <Td>{o.paymentMode ? <Chip tone={isCod ? 'cod' : 'grey'}>{isCod ? 'COD' : PAYMENT_LABEL[o.paymentMode] ?? o.paymentMode}</Chip> : <span className="text-v2-faint">–</span>}</Td>
                          <Td className="text-v2-muted">
                            {!isCod ? (
                              <span className="text-v2-faint">–</span>
                            ) : o.status !== 'DELIVERED' ? (
                              <span className="text-v2-faint">Not collected</span>
                            ) : (
                              <>
                                <Mono className="font-semibold text-v2-ink">{formatRupees(cash)}</Mono> {o.delivery?.codSettledAt ? 'handed to store' : 'with rider'}
                              </>
                            )}
                          </Td>
                          <Td className="max-w-[10rem] truncate text-v2-muted">{riderName.get(id) || '–'}</Td>
                        </tr>
                      )
                    })}
                  </tbody>
                </Table>
                <Pagination
                  page={page}
                  pageSize={pageSize}
                  total={inView.total}
                  buildHref={(t) => href({}, pagerExtra(t, { page: groupPage, pageSize: bk.pageSize }))}
                  className="border-t border-v2-line"
                />
              </TableFrame>
            </Card>
          ) : null}
        </>
      )}
    </div>
  )
}

/** The last service date a bucket covers: the day before the next bucket starts, or the range's end. */
function lastDayOf(b: { key: string }, buckets: { key: string }[]): string {
  const i = buckets.findIndex((x) => x.key === b.key)
  const next = buckets[i + 1]
  if (!next) return b.key
  const d = new Date(`${next.key}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/** An outcome key or an exact status, as words. */
function filterLabel(status: string): string {
  return isOutcome(status) ? OUTCOME_WORD[status] : statusChip(status).label
}

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="rounded-md border border-current/40 px-1.5 font-mono text-[11px] tabular-nums">{children}</span>
}

/**
 * One headline figure, and the control that filters to it. Pressing the
 * active one again clears it. The first is the hero, as on the dashboard.
 */
function Stat({
  label, value, href, hero, active, className, children,
}: {
  label: string
  value: string
  href: string
  hero?: boolean
  active: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? 'true' : undefined}
      className={cx(
        'relative grid content-start gap-3 overflow-hidden rounded-v2-lg border p-[18px] transition-colors',
        hero ? 'border-v2-brand-deep bg-v2-brand-deep text-white' : active ? 'border-v2-brand bg-v2-brand-soft' : 'border-v2-line bg-v2-surface hover:bg-v2-surface-2',
        className,
      )}
    >
      {hero ? (
        <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full bg-[radial-gradient(circle,rgba(143,220,180,0.35),rgba(143,220,180,0)_65%)]" />
      ) : null}
      <span className="flex items-center justify-between text-[15px] font-semibold">
        {label}
        <span className={cx('grid h-[30px] w-[30px] place-items-center rounded-full border', hero ? (active ? 'border-white bg-white text-v2-brand-deep' : 'border-white/35') : active ? 'border-v2-brand bg-v2-brand text-white' : 'border-v2-line-strong')}>
          <ArrowUpRight size={14} strokeWidth={2} aria-hidden />
        </span>
      </span>
      <span className="text-[36px] font-bold leading-none tracking-[-0.04em] tabular-nums">{value}</span>
      <span className={cx('flex flex-wrap items-center gap-2 text-[12.5px]', hero ? 'text-v2-mint' : 'text-v2-muted')}>{children}</span>
    </Link>
  )
}

function Cash({ label, value, warm = false }: { label: string; value: string; warm?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-v2-cod/80">{label}</dt>
      <dd className={cx('mt-0.5 font-mono text-[15px] font-semibold tabular-nums', warm ? 'text-v2-cod' : 'text-v2-ink')}>{value}</dd>
    </div>
  )
}

/** A bar as long as the group is busy, split by how its orders turned out. */
function MixBar({ tally: t, peak }: { tally: Tally; peak: number }) {
  const parts = OUTCOMES.filter((o) => t.counts[o] > 0)
  return (
    <span
      className="flex h-2.5 w-full min-w-[8rem]"
      role="img"
      aria-label={parts.map((o) => `${t.counts[o]} ${OUTCOME_WORD[o].toLowerCase()}`).join(', ')}
    >
      <span className="flex h-full min-w-2 gap-px overflow-hidden rounded-full" style={{ width: `${(t.total / peak) * 100}%` }}>
        {parts.map((o: Outcome) => (
          <span key={o} className={cx('block h-full', OUTCOME_SWATCH[o])} style={{ flex: `${t.counts[o]} 1 0` }} />
        ))}
      </span>
    </span>
  )
}
