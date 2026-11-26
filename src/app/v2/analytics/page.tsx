import Link from 'next/link'
import { ArrowLeft, Download, Lightbulb } from 'lucide-react'
import { requirePermission } from '@/lib/session'
import { loadReportOrders, phonesSeenBefore, riderNames } from '@/lib/repo/reportsRepo'
import { loadOutletChoices } from '@/lib/v2/riders'
import {
  WEEKDAYS, WEEKDAY_NAMES, bulkSummary, hourSpan, busiestSlot, busyGrid, change, dishStats, groupBy, headline, hourLabel, losses,
  placedByHour, reportPeriod, returning, riderStats, salesSeries, type DishStat, type ReportPeriod,
} from '@/lib/v2/reports'
import { sourceLabel } from '@/lib/orderEnums'
import { formatDateRange, formatRupees, formatShortDate, todayIST } from '@/lib/format'
import { QueryForm } from '@/components/QueryForm'
import { DateFilter } from '@/components/v2/DateFilter'
import { Select } from '@/components/v2/Select'
import { Card, buttonClass, cx } from '@/components/v2/ui'
import { Notice, PageHeader, PillTabs } from '@/components/v2/Table'
import { ColumnChart, HeatGrid, RankBars, SplitBar, StatTile } from '@/components/v2/ReportCharts'

export const metadata = { title: 'Reports · RailServe' }

type SP = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? '').trim()

const VIEWS = [
  { key: 'summary', label: 'Summary' },
  { key: 'dishes', label: 'Dishes' },
  { key: 'busy', label: 'Busy times' },
  { key: 'sources', label: 'Where orders come from' },
  { key: 'losses', label: 'Money lost' },
  { key: 'riders', label: 'Riders' },
] as const
type View = (typeof VIEWS)[number]['key']

/**
 * Reports, for a restaurant owner: how the business is doing against the same
 * days before, what sells and when, when the kitchen is busiest, where orders
 * come from, where money is lost, and how the riders are doing. Every figure
 * is worked out in lib/v2/reports, which says what counts.
 */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePermission('analytics.view')
  const sp = await searchParams
  const today = todayIST()
  const period = reportPeriod(one(sp.mode) || 'week', { from: one(sp.from), to: one(sp.to) }, today)
  const view: View = (VIEWS.find((v) => v.key === one(sp.view))?.key ?? 'summary') as View
  const outlet = one(sp.outlet)
  const dishParam = one(sp.dish)

  const [all, outlets] = await Promise.all([
    loadReportOrders(ctx, { from: period.prevFrom < period.from ? period.prevFrom : period.from, to: period.to }, { outletId: outlet || null }),
    loadOutletChoices(ctx),
  ])
  const now = all.filter((o) => o.serviceDate >= period.from && o.serviceDate <= period.to)
  const before = all.filter((o) => o.serviceDate >= period.prevFrom && o.serviceDate <= period.prevTo)
  const h = headline(now)
  const hb = headline(before)

  // Links keep the period and kitchen; each view and dish adds its own.
  const base = new URLSearchParams()
  if (period.mode !== 'week') base.set('mode', period.mode)
  if (period.mode === 'range') {
    base.set('from', period.from)
    base.set('to', period.to)
  }
  if (outlet) base.set('outlet', outlet)
  const href = (over: Record<string, string>) => {
    const u = new URLSearchParams(base)
    for (const [k, v] of Object.entries(over)) {
      if (v) u.set(k, v)
      else u.delete(k)
    }
    const s = u.toString()
    return s ? `/v2/analytics?${s}` : '/v2/analytics'
  }
  const viewHref = (v: View) => href({ view: v === 'summary' ? '' : v })
  const exportHref = `/admin/analytics/export?report=orders&mode=range&from=${period.from}&to=${period.to}${outlet ? `&outlet=${outlet}` : ''}`
  const outletName = new Map(outlets.map((o) => [o.id, o.label]))

  return (
    <div className="grid gap-[18px]">
      <PageHeader
        title="Reports"
        note={`${formatDateRange(period.from, period.to)} · changes are against ${period.versus}`}
        actions={
          ctx.role === 'ADMIN' ? (
            <a href={exportHref} download className={buttonClass('secondary', 'md')}>
              <Download size={16} aria-hidden />
              Download orders
            </a>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-2.5">
        <DateFilter
          key={`${period.mode}|${period.from}|${period.to}`}
          mode={period.mode}
          month=""
          from={period.mode === 'range' ? period.from : ''}
          to={period.mode === 'range' ? period.to : ''}
          quick
          autoSubmit
          className="w-fit"
        />
        {outlets.length > 1 ? (
          <QueryForm action="/v2/analytics" className="flex items-center gap-2">
            {[...base.entries()].filter(([k]) => k !== 'outlet').map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            {view !== 'summary' ? <input type="hidden" name="view" value={view} /> : null}
            <Select
              name="outlet"
              aria-label="Kitchen"
              value={outlet}
              submitOnChange
              options={[{ value: '', label: 'All kitchens' }, ...outlets.map((o) => ({ value: o.id, label: o.label }))]}
            />
          </QueryForm>
        ) : null}
      </div>

      <PillTabs tabs={VIEWS.map((v) => ({ href: viewHref(v.key), label: v.label, active: v.key === view }))} />

      {h.unclosedOrders > 0 && period.to < today ? (
        <Notice tone="warn">
          {h.unclosedOrders} order{h.unclosedOrders === 1 ? ' was' : 's were'} never marked delivered or not delivered ({formatRupees(h.unclosedPaise)}). They are counted as sales. Ask your team to close every order after delivery so these numbers stay right.
        </Notice>
      ) : null}

      {view === 'summary' ? (
        <Summary now={now} before={before} h={h} hb={hb} period={period} href={href} />
      ) : view === 'dishes' ? (
        <Dishes now={now} before={before} period={period} dishParam={dishParam} href={href} />
      ) : view === 'busy' ? (
        <Busy now={now} period={period} />
      ) : view === 'sources' ? (
        <Sources now={now} before={before} period={period} outletName={outletName} seen={await phonesSeenBefore(ctx, [...new Set(now.map((o) => o.phone).filter((p): p is string => Boolean(p)))], period.from)} showKitchens={!outlet && outlets.length > 1} />
      ) : view === 'losses' ? (
        <Losses now={now} before={before} isAdmin={ctx.role === 'ADMIN'} />
      ) : (
        <Riders now={now} names={await riderNames(ctx, [...new Set(now.map((o) => o.riderId).filter((x): x is string => Boolean(x)))])} />
      )}
    </div>
  )
}

type Orders = Parameters<typeof headline>[0]
type Href = (over: Record<string, string>) => string

/* ── Summary ───────────────────────────────────────────────────────────── */

function Summary({ now, before, h, hb, period, href }: { now: Orders; before: Orders; h: ReturnType<typeof headline>; hb: ReturnType<typeof headline>; period: ReportPeriod; href: Href }) {
  const series = salesSeries(now, period)
  const single = period.days.length === 1
  const { dishes } = dishStats(now, before)
  const sources = groupBy(now, (o) => o.source).filter((s) => s.orders > 0)
  const insights = summaryInsights(now, before, h, hb, period, href)
  return (
    <div className="grid gap-[18px]">
      <div className="grid grid-cols-2 gap-3 sm:gap-3.5 xl:grid-cols-4 [&>*:first-child]:col-span-2 sm:[&>*:first-child]:col-span-1">
        <StatTile hero label="Sales" value={formatRupees(h.salesPaise)} change={change(h.salesPaise, hb.salesPaise)} note={hb.orders ? `${formatRupees(hb.salesPaise)} ${period.versus}` : `no orders ${period.versus} to compare`} />
        <StatTile label="Orders" value={h.orders.toLocaleString('en-IN')} change={change(h.orders, hb.orders)} note={hb.orders ? `${hb.orders} ${period.versus}` : 'nothing before to compare'} />
        <StatTile label="Average order" value={formatRupees(h.avgPaise)} change={change(h.avgPaise, hb.avgPaise)} note={hb.orders ? `${formatRupees(hb.avgPaise)} ${period.versus}` : 'nothing before to compare'} />
        <StatTile label="Money lost" value={formatRupees(h.lostPaise)} change={change(h.lostPaise, hb.lostPaise)} goodWhen="down" note="food made but not sold, and refunds you paid" />
      </div>

      <div className="grid gap-[18px] xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card title={single ? 'Sales by the hour trains arrive' : 'Sales by day'}>
          <ColumnChart
            rows={series.map((r) => ({
              key: r.key,
              label: single ? r.label : period.days.length > 7 ? String(Number(r.key.slice(8))) : formatShortDate(r.key).replace(/^\w+\s/, ''),
              value: r.paise,
              tip: single ? `${r.label} · ${r.orders} order${r.orders === 1 ? '' : 's'}` : `${formatShortDate(r.key)} · ${r.orders} order${r.orders === 1 ? '' : 's'}`,
            }))}
            format={(v) => formatRupees(v)}
          />
          <div className="mt-4 border-t border-v2-line pt-4">
            <SplitBar
              parts={[
                { label: 'Paid online', value: h.onlinePaise, valueText: formatRupees(h.onlinePaise), tone: 'brand' },
                { label: 'Cash at the door', value: h.cashPaise, valueText: formatRupees(h.cashPaise), tone: 'soft' },
              ]}
            />
          </div>
        </Card>

        <Card title="What stands out">
          {insights.length ? (
            <ul className="grid gap-3">
              {insights.map((i, n) => (
                <li key={n} className="flex gap-3">
                  <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-v2-brand-soft text-v2-brand">
                    <Lightbulb size={15} aria-hidden />
                  </span>
                  <span className="text-[14.5px] leading-snug">
                    {i.text}{' '}
                    {i.href ? (
                      <Link href={i.href} className="font-semibold text-v2-brand hover:underline">
                        {i.link}
                      </Link>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-v2-muted">Nothing to point out yet. It fills in as orders come in.</p>
          )}
        </Card>
      </div>

      <div className="grid gap-[18px] xl:grid-cols-2">
        <Card title="Best sellers" action={<Link href={href({ view: 'dishes' })} className="text-[13px] font-semibold text-v2-brand">All dishes</Link>}>
          {dishes.length ? (
            <RankBars rows={dishes.slice(0, 6).map((d) => ({ key: d.key, label: d.name, value: d.qty, valueText: `${d.qty} sold`, href: href({ view: 'dishes', dish: d.key }) }))} />
          ) : (
            <p className="text-sm text-v2-muted">No dishes sold in these dates.</p>
          )}
        </Card>
        <Card title="Where sales come from" action={<Link href={href({ view: 'sources' })} className="text-[13px] font-semibold text-v2-brand">More</Link>}>
          {sources.length ? (
            <RankBars rows={sources.slice(0, 6).map((s) => ({ key: s.key, label: sourceLabel(s.key), sub: `${s.orders} orders`, value: s.salesPaise, valueText: `${s.share}%` }))} />
          ) : (
            <p className="text-sm text-v2-muted">No sales in these dates.</p>
          )}
        </Card>
      </div>
    </div>
  )
}

type Insight = { text: string; link?: string; href?: string }

/** A few plain sentences about the period: what changed, what sells, when, and the biggest leak. */
function summaryInsights(now: Orders, before: Orders, h: ReturnType<typeof headline>, hb: ReturnType<typeof headline>, period: ReportPeriod, href: Href): Insight[] {
  const out: Insight[] = []
  const c = change(h.salesPaise, hb.salesPaise)
  if (c != null && c !== 0) out.push({ text: `Sales are ${c > 0 ? 'up' : 'down'} ${Math.abs(c)}% on ${period.versus} (${formatRupees(h.salesPaise)} against ${formatRupees(hb.salesPaise)}).` })
  const { dishes } = dishStats(now, before)
  if (dishes[0]) out.push({ text: `${dishes[0].name} is your best seller: ${dishes[0].qty} sold.`, link: 'See when', href: href({ view: 'dishes', dish: dishes[0].key }) })
  const riser = dishes.filter((d) => d.prevQty >= 2 && (d.change ?? 0) >= 30).sort((a, b) => b.qty - b.prevQty - (a.qty - a.prevQty))[0]
  if (riser) out.push({ text: `${riser.name} is selling more: ${riser.qty} against ${riser.prevQty}.`, link: 'Dishes', href: href({ view: 'dishes' }) })
  const slot = busiestSlot(busyGrid(now))
  if (slot && slot.orders >= 2) out.push({ text: `Busiest time: ${period.days.length >= 7 ? `${WEEKDAY_NAMES[slot.weekday]}, ` : ''}${hourLabel(slot.hour)} to ${hourLabel(slot.hour + 2)}, by when trains arrive. Have the kitchen ready before then.`, link: 'Busy times', href: href({ view: 'busy' }) })
  const l = losses(now)
  if (l.cookedLost.paise > 0) out.push({ text: `${formatRupees(l.cookedLost.paise)} of food was made and then cancelled or not delivered (${l.cookedLost.orders} order${l.cookedLost.orders === 1 ? '' : 's'}).`, link: 'Why', href: href({ view: 'losses' }) })
  const top = groupBy(now, (o) => o.source)[0]
  if (top && top.share >= 40 && top.key !== '—') out.push({ text: `${sourceLabel(top.key)} brings ${top.share}% of your sales.` })
  return out.slice(0, 5)
}

/* ── Dishes ────────────────────────────────────────────────────────────── */

/** "1 pm to 3 pm": the dish's busiest two hours. */
function peakHours(byHour: number[]): string | null {
  let best = -1
  let n = 0
  for (let x = 0; x < 23; x++) if (byHour[x] + byHour[x + 1] > n) [best, n] = [x, byHour[x] + byHour[x + 1]]
  return best < 0 ? null : hourSpan(best, best + 2)
}

function trendChip(d: { change: number | null; prevQty: number }) {
  if (d.prevQty === 0) return <span className="font-semibold text-v2-info">New</span>
  if (d.change == null || d.change === 0) return <span className="text-v2-muted">Same</span>
  return <span className={cx('font-semibold', d.change > 0 ? 'text-v2-ok' : 'text-v2-bad')}>{d.change > 0 ? '↑' : '↓'} {Math.abs(d.change)}%</span>
}

function Dishes({ now, before, period, dishParam, href }: { now: Orders; before: Orders; period: ReportPeriod; dishParam: string; href: Href }) {
  const { dishes, stopped } = dishStats(now, before)
  const bulk = bulkSummary(now)
  const picked = dishes.find((d) => d.key === dishParam) ?? null
  const rising = dishes.filter((d) => d.prevQty >= 2 && (d.change ?? 0) >= 25).sort((a, b) => b.qty - b.prevQty - (a.qty - a.prevQty)).slice(0, 5)
  const falling = dishes.filter((d) => d.prevQty >= 2 && (d.change ?? 0) <= -25).sort((a, b) => a.qty - a.prevQty - (b.qty - b.prevQty)).slice(0, 5)
  const weekly = period.days.length >= 7
  return (
    <div className="grid gap-[18px]">
      {picked ? <DishDetail d={picked} period={period} back={href({ view: 'dishes', dish: '' })} /> : null}

      <div className="grid gap-[18px] xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card title="What sells most" action={<span className="text-[12.5px] text-v2-muted">Tap a dish to see when it sells</span>}>
          {dishes.length ? (
            <RankBars
              rows={dishes.slice(0, 25).map((d) => ({
                key: d.key,
                label: d.name,
                sub: [peakHours(d.byHour) ? `Sells most ${peakHours(d.byHour)}` : null, weekly ? `${WEEKDAYS[d.byWeekday.indexOf(Math.max(...d.byWeekday))]}` : null].filter(Boolean).join(' · '),
                value: d.qty,
                valueText: `${d.qty}`,
                aside: trendChip(d),
                href: href({ view: 'dishes', dish: d.key }),
              }))}
            />
          ) : (
            <p className="text-sm text-v2-muted">No dishes sold in these dates.</p>
          )}
          {dishes.length > 25 ? <p className="mt-2 px-2.5 text-[12.5px] text-v2-muted">And {dishes.length - 25} more dishes that sold less.</p> : null}
          <p className="mt-3 border-t border-v2-line px-2.5 pt-3 text-[12.5px] text-v2-muted">
            Counted by plates sold. Aggregator emails do not say the price of each dish, only the order total.
            {bulk.orders ? ` Group bookings are counted apart: ${bulk.orders} order${bulk.orders === 1 ? '' : 's'}, ${bulk.plates} plates, ${formatRupees(bulk.paise)}.` : ''}
          </p>
        </Card>

        <div className="grid content-start gap-[18px]">
          <Card title="Selling more">
            {rising.length ? <DishMoves list={rising} href={href} /> : <p className="text-sm text-v2-muted">No dish rose sharply against {period.versus}.</p>}
          </Card>
          <Card title="Selling less">
            {falling.length ? <DishMoves list={falling} href={href} /> : <p className="text-sm text-v2-muted">No dish fell sharply against {period.versus}.</p>}
          </Card>
          <Card title="Stopped selling">
            {stopped.length ? (
              <>
                <p className="mb-2 text-[13px] text-v2-muted">Sold {period.versus}, none now. Check they are still on the aggregator apps, or think about dropping them.</p>
                <ul className="grid gap-1.5 text-[14px]">
                  {stopped.slice(0, 6).map((s) => (
                    <li key={s.name} className="flex justify-between gap-3">
                      <span className="truncate">{s.name}</span>
                      <span className="shrink-0 font-mono text-v2-muted">was {s.prevQty}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-v2-muted">Every dish that sold before is still selling.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

function DishMoves({ list, href }: { list: DishStat[]; href: Href }) {
  return (
    <ul className="grid gap-1.5 text-[14px]">
      {list.map((d) => (
        <li key={d.key}>
          <Link href={href({ view: 'dishes', dish: d.key })} scroll={false} className="flex justify-between gap-3 rounded-v2-sm hover:text-v2-brand">
            <span className="truncate font-semibold">{d.name}</span>
            <span className="shrink-0 font-mono">
              {d.prevQty} → {d.qty}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function DishDetail({ d, period, back }: { d: DishStat; period: ReportPeriod; back: string }) {
  const hours = d.byHour.map((v, i) => ({ v, i })).filter((x) => x.v > 0)
  const first = hours[0]?.i ?? 8
  const last = hours[hours.length - 1]?.i ?? 20
  const span = Array.from({ length: last - first + 1 }, (_, i) => first + i)
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={back} scroll={false} className="mb-1 inline-flex items-center gap-1 text-[13px] font-semibold text-v2-muted hover:text-v2-brand">
            <ArrowLeft size={14} aria-hidden />
            All dishes
          </Link>
          <h2 className="text-[22px] font-bold">{d.name}</h2>
          <p className="text-[14px] text-v2-muted">
            {d.qty} sold in {d.orders} order{d.orders === 1 ? '' : 's'} · {d.prevQty} {period.versus}
          </p>
        </div>
        <span className="text-[15px]">{trendChip(d)}</span>
      </div>
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-[13.5px] font-semibold text-v2-ink-2">When it is needed (train arrival)</h3>
          <ColumnChart rows={span.map((h) => ({ key: String(h), label: hourLabel(h), value: d.byHour[h], tip: `${hourLabel(h)} to ${hourLabel(h + 1)}` }))} format={(v) => String(Math.round(v))} labelEvery={2} />
        </div>
        <div>
          <h3 className="mb-2 text-[13.5px] font-semibold text-v2-ink-2">{period.days.length >= 7 ? 'By day of the week' : 'By day'}</h3>
          {period.days.length >= 7 ? (
            <ColumnChart rows={WEEKDAYS.map((w, i) => ({ key: w, label: w, value: d.byWeekday[i], tip: WEEKDAY_NAMES[i] }))} format={(v) => String(Math.round(v))} labelEvery={1} />
          ) : (
            <ColumnChart rows={period.days.map((day) => ({ key: day, label: formatShortDate(day).replace(/^\w+\s/, ''), value: d.byDay.get(day) ?? 0, tip: formatShortDate(day) }))} format={(v) => String(Math.round(v))} labelEvery={1} />
          )}
        </div>
      </div>
    </Card>
  )
}

/* ── Busy times ────────────────────────────────────────────────────────── */

function Busy({ now, period }: { now: Orders; period: ReportPeriod }) {
  const grid = busyGrid(now)
  const slot = busiestSlot(grid)
  const placed = placedByHour(now)
  const firstP = placed.findIndex((v) => v > 0)
  const lastP = 23 - [...placed].reverse().findIndex((v) => v > 0)
  const peakPlaced = placed.indexOf(Math.max(...placed))
  const days = grid.map((row) => row.reduce((a, b) => a + b, 0))
  return (
    <div className="grid gap-[18px]">
      <Card title="When food is needed" action={<span className="text-[12.5px] text-v2-muted">Orders by the hour their train arrives</span>}>
        {slot ? (
          <p className="mb-4 text-[14.5px]">
            Busiest: <b>{period.days.length >= 7 ? `${WEEKDAY_NAMES[slot.weekday]}, ` : ''}{hourLabel(slot.hour)} to {hourLabel(slot.hour + 2)}</b> ({slot.orders} orders). Plan cooking and riders to be ready before this.
          </p>
        ) : null}
        <HeatGrid grid={grid} rowLabels={WEEKDAYS} hourLabel={hourLabel} />
        {period.days.length < 7 ? <p className="mt-3 text-[12.5px] text-v2-muted">Pick This month for a fuller picture of each weekday.</p> : null}
      </Card>
      <div className="grid gap-[18px] xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card title="When orders come in" action={<span className="text-[12.5px] text-v2-muted">By the hour the order arrived</span>}>
          {firstP >= 0 ? (
            <>
              <p className="mb-4 text-[14.5px]">
                Most orders arrive around <b>{hourLabel(peakPlaced)}</b>. Keep someone on the call desk and the email inbox then.
              </p>
              <ColumnChart rows={Array.from({ length: lastP - firstP + 1 }, (_, i) => firstP + i).map((hh) => ({ key: String(hh), label: hourLabel(hh), value: placed[hh], tip: `${hourLabel(hh)} to ${hourLabel(hh + 1)}` }))} format={(v) => String(Math.round(v))} labelEvery={2} />
            </>
          ) : (
            <p className="text-sm text-v2-muted">No orders in these dates.</p>
          )}
        </Card>
        <Card title="Busiest days">
          <RankBars rows={WEEKDAYS.map((w, i) => ({ key: w, label: WEEKDAY_NAMES[i], value: days[i], valueText: `${days[i]}` })).filter((r) => r.value > 0).sort((a, b) => b.value - a.value)} />
        </Card>
      </div>
    </div>
  )
}

/* ── Where orders come from ────────────────────────────────────────────── */

function Sources({ now, before, period, outletName, seen, showKitchens }: { now: Orders; before: Orders; period: ReportPeriod; outletName: Map<string, string>; seen: Set<string>; showKitchens: boolean }) {
  const sources = groupBy(now, (o) => o.source)
  const prevSources = new Map(groupBy(before, (o) => o.source).map((s) => [s.key, s]))
  const kitchens = groupBy(now, (o) => o.outletId)
  const stations = groupBy(now, (o) => o.stationCode)
  const trains = groupBy(now, (o) => (o.trainNo ? `${o.trainNo}${o.trainName ? ` ${o.trainName}` : ''}` : null)).filter((t) => t.key !== '—').sort((a, b) => b.orders - a.orders).slice(0, 10)
  const back = returning(now, seen)
  return (
    <div className="grid gap-[18px]">
      <Card title="Aggregators" action={<span className="text-[12.5px] text-v2-muted">Share of sales · change in sales</span>}>
        {sources.length ? (
          <RankBars
            rows={sources.map((s) => {
              const p = prevSources.get(s.key)
              return {
                key: s.key,
                label: sourceLabel(s.key),
                sub: `${s.orders} orders · ${formatRupees(s.salesPaise)} · average ${formatRupees(s.avgPaise)}${s.lostRate ? ` · ${s.lostRate}% cancelled or not delivered` : ''}`,
                value: s.salesPaise,
                valueText: `${s.share}%`,
                aside: trendChip({ change: change(s.salesPaise, p?.salesPaise ?? 0), prevQty: p?.salesPaise ?? 0 }),
              }
            })}
          />
        ) : (
          <p className="text-sm text-v2-muted">No orders in these dates.</p>
        )}
      </Card>

      <div className="grid gap-[18px] xl:grid-cols-2">
        <Card title="Trains that order most">
          {trains.length ? <RankBars rows={trains.map((t) => ({ key: t.key, label: t.key, sub: formatRupees(t.salesPaise), value: t.orders, valueText: `${t.orders}` }))} /> : <p className="text-sm text-v2-muted">No orders in these dates.</p>}
        </Card>
        <div className="grid content-start gap-[18px]">
          <StatTile label="Passengers who came back" value={`${back.share}%`} note={`${back.returning} of ${back.passengers} passengers had ordered before`} />
          {showKitchens ? (
            <Card title="Kitchens">
              <RankBars rows={kitchens.map((k) => ({ key: k.key, label: outletName.get(k.key) ?? 'No kitchen', sub: `${k.orders} orders`, value: k.salesPaise, valueText: formatRupees(k.salesPaise) }))} />
            </Card>
          ) : null}
          {stations.length > 1 ? (
            <Card title="Stations">
              <RankBars rows={stations.map((s) => ({ key: s.key, label: s.key, sub: `${s.orders} orders`, value: s.salesPaise, valueText: formatRupees(s.salesPaise) }))} />
            </Card>
          ) : null}
        </div>
      </div>
      <p className="text-[12.5px] text-v2-muted">Changes are against {period.versus}.</p>
    </div>
  )
}

/* ── Money lost ────────────────────────────────────────────────────────── */

function Losses({ now, before, isAdmin }: { now: Orders; before: Orders; isAdmin: boolean }) {
  const l = losses(now)
  const lb = losses(before)
  const sources = groupBy(now, (o) => o.source).filter((s) => s.lost > 0).sort((a, b) => b.lostRate - a.lostRate)
  return (
    <div className="grid gap-[18px]">
      <div className="grid grid-cols-2 gap-3 sm:gap-3.5 xl:grid-cols-4 [&>*:first-child]:col-span-2 sm:[&>*:first-child]:col-span-1">
        <StatTile hero label="Food made, not sold" value={formatRupees(l.cookedLost.paise)} change={change(l.cookedLost.paise, lb.cookedLost.paise)} goodWhen="down" note={`${l.cookedLost.orders} order${l.cookedLost.orders === 1 ? '' : 's'} cancelled or not delivered after cooking`} />
        <StatTile label="Refunds you paid" value={formatRupees(l.refundsUs.paise)} change={change(l.refundsUs.paise, lb.refundsUs.paise)} goodWhen="down" note={`${l.refundsUs.orders} refund${l.refundsUs.orders === 1 ? '' : 's'}${l.refundsAggregator.orders ? ` · ${formatRupees(l.refundsAggregator.paise)} more paid by aggregators` : ''}`} />
        <StatTile label="Cancelled before cooking" value={formatRupees(l.cancelledEarly.paise)} change={change(l.cancelledEarly.paise, lb.cancelledEarly.paise)} goodWhen="down" note={`${l.cancelledEarly.orders} order${l.cancelledEarly.orders === 1 ? '' : 's'}: a lost sale, but no food wasted`} />
        <StatTile label="Rating orders" value={formatRupees(l.rating.paise)} note={`${l.rating.orders} order${l.rating.orders === 1 ? '' : 's'} placed for app ratings`} />
      </div>

      <div className="grid gap-[18px] xl:grid-cols-2">
        <Card title="Why orders were not delivered">
          {l.notDelivered.reasons.length ? (
            <>
              <RankBars rows={l.notDelivered.reasons.slice(0, 8).map((r) => ({ key: r.reason, label: r.reason, value: r.orders, valueText: `${r.orders}` }))} />
              <p className="mt-3 border-t border-v2-line pt-3 text-[13px] text-v2-muted">
                {l.notDelivered.orders} order{l.notDelivered.orders === 1 ? '' : 's'} ({formatRupees(l.notDelivered.paise)}) were not delivered{l.returnedBags ? `; ${l.returnedBags} bag${l.returnedBags === 1 ? '' : 's'} came back to the kitchen` : ''}. Calling the passenger before the train arrives prevents most of these.
              </p>
            </>
          ) : (
            <p className="text-sm text-v2-muted">Every order that went out was delivered.</p>
          )}
        </Card>
        <Card title="Cancelled or not delivered, by aggregator">
          {sources.length ? (
            <RankBars rows={sources.map((s) => ({ key: s.key, label: sourceLabel(s.key), sub: `${s.lost} of ${s.lost + s.orders} orders`, value: s.lostRate, valueText: `${s.lostRate}%` }))} max={100} />
          ) : (
            <p className="text-sm text-v2-muted">Nothing was cancelled or undelivered.</p>
          )}
        </Card>
      </div>
      {isAdmin ? (
        <p className="text-[13px] text-v2-muted">
          Cash still with riders and staff is on{' '}
          <Link href="/v2/money" className="font-semibold text-v2-brand hover:underline">
            Money
          </Link>
          .
        </p>
      ) : null}
    </div>
  )
}

/* ── Riders ────────────────────────────────────────────────────────────── */

function Riders({ now, names }: { now: Orders; names: Map<string, string> }) {
  const stats = riderStats(now)
  if (stats.length === 0) return <Card><p className="text-sm text-v2-muted">No deliveries closed by riders in these dates.</p></Card>
  return (
    <Card title="Riders" action={<span className="text-[12.5px] text-v2-muted">Delivered and not delivered, in these dates</span>}>
      <RankBars
        rows={stats.map((r) => ({
          key: r.riderId,
          label: names.get(r.riderId) ?? 'A rider',
          sub: [r.notDelivered ? `${r.notDelivered} not delivered (${r.rate}%)` : 'none missed', r.avgMinutes != null ? `${r.avgMinutes} min from pickup to delivery on average` : null].filter(Boolean).join(' · '),
          value: r.delivered,
          valueText: `${r.delivered}`,
        }))}
      />
    </Card>
  )
}
