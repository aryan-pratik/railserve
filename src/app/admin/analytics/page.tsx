import { requireRole } from '@/lib/session'
import { dailyCounts, outletAnalytics } from '@/lib/repo/orderRepo'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'
import { formatDateRange, formatRupees, todayIST, EMPTY } from '@/lib/format'
import { Button, Card, CardHeader, EmptyState, PageHeader, Stat, StatStrip, thClass } from '@/components/ui'
import { QueryForm } from '@/components/QueryForm'
import { DateFilter } from '@/components/DateFilter'
import { resolveDateRange, type DateFilterMode } from '@/lib/dateFilter'

export const metadata = { title: 'Analytics · RailServe' }

function pct(n: number, d: number): string {
  if (d === 0) return EMPTY
  return `${Math.round((n / d) * 100)}%`
}

/* ── the orders-per-day chart ──────────────────────────────────────────────
 * Hand-drawn SVG rather than a chart library: two series, one axis, thirty
 * bars. Geometry lives here as named constants so the bars stay a constant
 * width whatever the range — a bar that changes width when you widen the
 * dates is a bar you cannot compare against yesterday's screenshot.
 */
const BAR_W = 14
const STEP = 22
const PLOT_H = 148
const PAD_L = 40
const PAD_R = 12
const PAD_T = 10
const PAD_B = 28
/** Segments of a stack are separated by surface, not by a border. */
const GAP = 2

/** Round the axis up to something a person would have chosen: 5, 20, 50, 200… */
function niceCeil(n: number): number {
  if (n <= 5) return 5
  const mag = 10 ** Math.floor(Math.log10(n))
  const r = n / mag
  const step = r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10
  return step * mag
}

/** A rect with only its top corners rounded, so the stack still sits flat on the baseline. */
function capPath(x: number, y: number, w: number, h: number, r = 3): string {
  const rr = Math.min(r, h, w / 2)
  return (
    `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} ` +
    `L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`
  )
}

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span className={`h-2.5 w-2.5 rounded-sm ${className}`} />
      {label}
    </span>
  )
}

function OrdersPerDayChart({ daily }: { daily: { serviceDate: string; orders: number; delivered: number }[] }) {
  const peak = Math.max(1, ...daily.map((d) => d.orders))
  const axisMax = niceCeil(peak)
  const ticks = axisMax % 2 === 0 ? [0, axisMax / 2, axisMax] : [0, axisMax]

  const width = PAD_L + daily.length * STEP + PAD_R
  const height = PAD_T + PLOT_H + PAD_B
  const base = PAD_T + PLOT_H
  const scale = (v: number) => (v / axisMax) * PLOT_H

  // Thirty day-of-month labels collide; thin them out but keep the ticks even.
  const labelEvery = Math.ceil(daily.length / 16) || 1

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Orders per day, delivered and not delivered"
      className="block"
    >
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={PAD_L - 4}
            x2={width - PAD_R}
            y1={base - scale(t)}
            y2={base - scale(t)}
            className={t === 0 ? 'stroke-line-strong' : 'stroke-line'}
            strokeWidth={1}
            strokeDasharray={t === 0 ? undefined : '2 3'}
          />
          <text
            x={PAD_L - 10}
            y={base - scale(t) + 3.5}
            textAnchor="end"
            className="fill-faint text-[10px] tabular-nums"
          >
            {t}
          </text>
        </g>
      ))}

      {daily.map((d, i) => {
        const x = PAD_L + i * STEP + (STEP - BAR_W) / 2
        const other = Math.max(0, d.orders - d.delivered)
        const hDelivered = d.delivered > 0 ? Math.max(2, scale(d.delivered)) : 0
        const hOther = other > 0 ? Math.max(2, scale(other)) : 0
        const otherY = base - hDelivered - (hDelivered > 0 ? GAP : 0) - hOther

        return (
          <g key={d.serviceDate}>
            <title>{`${d.serviceDate}: ${d.delivered} delivered, ${other} not delivered`}</title>
            {hOther > 0 ? (
              <path d={capPath(x, otherY, BAR_W, hOther)} className="fill-line-strong" />
            ) : null}
            {hDelivered > 0 ? (
              <path
                d={
                  hOther > 0
                    ? `M${x},${base} L${x},${base - hDelivered} L${x + BAR_W},${base - hDelivered} L${x + BAR_W},${base} Z`
                    : capPath(x, base - hDelivered, BAR_W, hDelivered)
                }
                className="fill-accent"
              />
            ) : null}
            {i % labelEvery === 0 ? (
              <text
                x={x + BAR_W / 2}
                y={base + 16}
                textAnchor="middle"
                className="fill-faint text-[10px] tabular-nums"
              >
                {d.serviceDate.slice(8)}
              </text>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}

export default async function AnalyticsPage(props: PageProps<'/admin/analytics'>) {
  const ctx = await requireRole('ADMIN')
  const sp = await props.searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''

  const mode = (one(sp.mode) || 'month') as DateFilterMode
  const month = one(sp.month)
  const rawFrom = one(sp.from)
  const rawTo = one(sp.to)
  const resolved = resolveDateRange(mode, { month, from: rawFrom, to: rawTo })
  const from = resolved.from || todayIST()
  const to = resolved.to || todayIST()

  const [stats, daily, outlets] = await Promise.all([
    outletAnalytics(ctx, { from, to }),
    dailyCounts(ctx, { from, to }),
    connectDb().then(() => Restaurant.find({}).select('name stationCode').lean()),
  ])

  const name = new Map(outlets.map((o) => [String(o._id), `${o.name} · ${o.stationCode}`]))

  const totals = stats.reduce(
    (a, s) => ({
      orders: a.orders + s.orders,
      delivered: a.delivered + s.delivered,
      failed: a.failed + s.failed,
      missed: a.missed + s.missed,
      missedRevenuePaise: a.missedRevenuePaise + s.missedRevenuePaise,
      revenuePaise: a.revenuePaise + s.revenuePaise,
    }),
    { orders: 0, delivered: 0, failed: 0, missed: 0, missedRevenuePaise: 0, revenuePaise: 0 },
  )

  const kpis = [
    { label: 'Orders', value: String(totals.orders), sub: null, tone: 'text-ink' },
    {
      label: 'Delivered',
      value: String(totals.delivered),
      sub: `${pct(totals.delivered, totals.orders)} of orders`,
      tone: 'text-ink',
    },
    {
      label: 'Missed',
      value: String(totals.missed),
      sub: `${pct(totals.missed, totals.orders)} of orders`,
      tone: totals.missed > 0 ? 'text-red-600' : 'text-ink',
    },
    {
      label: 'Missed value',
      value: formatRupees(totals.missedRevenuePaise),
      sub: null,
      tone: totals.missedRevenuePaise > 0 ? 'text-red-600' : 'text-ink',
    },
    { label: 'Delivered value', value: formatRupees(totals.revenuePaise), sub: null, tone: 'text-ink' },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Analytics"
        note={formatDateRange(from, to)}
        action={
          <QueryForm action="/admin/analytics" className="flex flex-wrap items-center gap-2">
            <DateFilter mode={mode} month={month} from={rawFrom} to={rawTo} />
            <Button type="submit" variant="secondary">Apply</Button>
          </QueryForm>
        }
      />

      <StatStrip columns={5}>
        {kpis.map((k) => (
          <Stat key={k.label} label={k.label} value={k.value} note={k.sub} tone={k.tone} />
        ))}
      </StatStrip>

      {stats.length === 0 ? (
        <EmptyState title="No orders in this range" note="Widen the dates to see more." />
      ) : (
        <>
          <Card className="overflow-hidden">
            <CardHeader title="By outlet" />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] text-sm">
                <thead className="border-b border-line bg-sunken/60">
                  <tr>
                    <th className={thClass}>Outlet</th>
                    <th className={`${thClass} text-right`}>Orders</th>
                    <th className={`${thClass} text-right`}>Delivered</th>
                    <th className={`${thClass} text-right`}>Success</th>
                    <th className={`${thClass} text-right`}>Missed</th>
                    <th className={`${thClass} text-right`}>Missed value</th>
                    <th className={`${thClass} text-right`}>Received to delivered</th>
                    <th className={`${thClass} text-right`}>Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {stats.map((s) => (
                    <tr key={s.restaurantId ?? 'none'} className="transition-colors hover:bg-sunken/60">
                      <td className="px-3 py-2.5 font-medium text-ink">
                        {s.restaurantId ? (name.get(s.restaurantId) ?? 'Unknown outlet') : 'Unassigned'}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted">{s.orders}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted">{s.delivered}</td>
                      <td className="px-3 py-2.5 text-right font-medium tabular-nums text-ink">
                        {pct(s.delivered, s.orders)}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right tabular-nums ${s.missed > 0 ? 'font-medium text-red-600' : 'text-muted'}`}
                      >
                        {s.missed}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right tabular-nums ${s.missedRevenuePaise > 0 ? 'font-medium text-red-600' : 'text-muted'}`}
                      >
                        {formatRupees(s.missedRevenuePaise)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted">
                        {s.avgReceivedToDeliveredMinutes !== null
                          ? `${s.avgReceivedToDeliveredMinutes} min`
                          : EMPTY}
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium tabular-nums text-ink">
                        {formatRupees(s.revenuePaise)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader
              title="Orders per day"
              action={
                <div className="flex items-center gap-3">
                  <LegendSwatch className="bg-accent" label="Delivered" />
                  <LegendSwatch className="bg-line-strong" label="Not delivered" />
                </div>
              }
            />
            <div className="overflow-x-auto px-4 py-3">
              <OrdersPerDayChart daily={daily} />
            </div>
            <p className="border-t border-line px-4 py-2.5 text-xs text-muted">
              Day of month along the bottom, orders up the side.
            </p>
          </Card>
        </>
      )}
    </div>
  )
}
