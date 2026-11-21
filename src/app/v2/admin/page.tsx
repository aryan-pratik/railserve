import Link from 'next/link'
import { ArrowUpRight, Plus } from 'lucide-react'
import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { countOrders } from '@/lib/repo/orderRepo'
import { listPendingCancelRequests } from '@/lib/repo/cancelRequestRepo'
import { listReturns, countPendingReturns } from '@/lib/repo/rtoRepo'
import { riderBoard } from '@/lib/repo/riderLocationRepo'
import { checkIngestStaleness } from '@/lib/ingest/gmail/sync'
import { LIVE_STATUSES } from '@/lib/repo/runRepo'
import { TERMINAL_STATUSES } from '@/lib/orderStatus'
import { runTrainLabel } from '@/lib/runs'
import { formatRupees, formatServiceDate, formatTimeIST, shiftServiceDate, todayIST, utcToIstLocal } from '@/lib/format'
import { loadDay, loadToday, nextArrival } from '@/lib/v2/dashboard'
import { DayPicker } from '@/components/v2/DayPicker'
import { Avatar, ButtonLink, Card, Chip, Mono, cx } from '@/components/v2/ui'
import { Countdown } from '@/components/v2/Countdown'

export const metadata = { title: 'Today · RailServe' }

const LIVE = new Set<string>(LIVE_STATUSES)
const TERMINAL = new Set<string>(TERMINAL_STATUSES)

export default async function V2AdminDashboard(props: PageProps<'/v2/admin'>) {
  const ctx = await requireRole('ADMIN')
  const sp = await props.searchParams
  await connectDb()

  const now = new Date()
  const serverNowMs = now.getTime()
  const today = todayIST(now)
  // `?date=` shows another service day's figures; the live parts (next
  // arrival, riders on the platform) only make sense for today.
  const rawDate = Array.isArray(sp.date) ? sp.date[0] : sp.date
  const day = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && rawDate !== today ? rawDate : today
  const isToday = day === today
  const yesterday = shiftServiceDate(day, -1)

  const [{ board, outletById }, yesterdayTotal, cancelRequests, returns, returnsPending, riders, ingest] = await Promise.all([
    isToday ? loadToday(ctx) : loadDay(ctx, day),
    countOrders(ctx, { serviceDate: yesterday }),
    listPendingCancelRequests(ctx, { limit: 3 }),
    listReturns(ctx, { status: 'PENDING', limit: 2, skip: 0 }),
    countPendingReturns(ctx),
    riderBoard(ctx, { now }),
    checkIngestStaleness(now),
  ])

  const orders = board.runs.flatMap((r) => r.orders)
  const count = (pred: (status: string) => boolean) => orders.filter((o) => pred(o.status)).length
  const total = orders.length
  const live = count((s) => LIVE.has(s))
  const ready = count((s) => s === 'PREPARED')
  const out = count((s) => s === 'DISPATCHED')
  const delivered = count((s) => s === 'DELIVERED')
  const cookingOrNew = count((s) => s === 'RECEIVED' || s === 'ACCEPTED' || s === 'KOT_PRINTED')
  const closedBadly = count((s) => TERMINAL.has(s) && s !== 'DELIVERED')
  const attention = cancelRequests.length + returnsPending
  const delta = total - yesterdayTotal

  const next = isToday ? nextArrival(board, outletById) : null

  // Orders per hour of arrival, over a ten-hour window around now. Past hours
  // are solid, the current hour is the dark one, hours to come are hatched.
  const nowHour = Number(utcToIstLocal(now).slice(11, 13))
  // Another day's window starts at its first arrival instead of around now.
  const orderHours = orders
    .map((o) => (board.timingOf(board.runs.find((r) => r.orders.includes(o))!).effectiveArrival ?? o.scheduledArrival))
    .filter((d): d is Date => Boolean(d))
    .map((d) => Number(utcToIstLocal(d).slice(11, 13)))
  const anchorHour = isToday ? nowHour - 3 : orderHours.length ? Math.min(...orderHours) - 1 : 6
  const startHour = Math.min(Math.max(anchorHour, 0), 14)
  const hours = Array.from({ length: 10 }, (_, i) => startHour + i)
  const perHour = new Map(hours.map((h) => [h, 0]))
  for (const o of orders) {
    const at = board.timingOf(board.runs.find((r) => r.orders.includes(o))!).effectiveArrival ?? o.scheduledArrival
    if (!at) continue
    const h = Number(utcToIstLocal(at).slice(11, 13))
    if (perHour.has(h)) perHour.set(h, perHour.get(h)! + 1)
  }
  const peak = Math.max(1, ...perHour.values())
  const peakHour = hours.find((h) => perHour.get(h) === peak && peak > 0)

  // The runs list: five soonest, with the one word that describes the train.
  const trainRows = board.runs.slice(0, 5).map((run) => {
    const t = board.timingOf(run)
    const statuses = run.orders.map((o) => o.status)
    const liveOnRun = statuses.filter((s) => LIVE.has(s))
    const word = (() => {
      if (statuses.some((s) => s === 'DISPATCHED') && (t.arrived || liveOnRun.every((s) => s === 'DISPATCHED')))
        return { tone: 'out' as const, label: 'On platform' }
      if (liveOnRun.length === 0) return { tone: 'grey' as const, label: 'Done' }
      if (liveOnRun.every((s) => s === 'PREPARED' || s === 'DISPATCHED')) return { tone: 'ok' as const, label: 'Ready' }
      if (liveOnRun.some((s) => s === 'ACCEPTED' || s === 'KOT_PRINTED')) return { tone: 'warn' as const, label: 'Cooking' }
      return { tone: 'info' as const, label: 'New' }
    })()
    const readyN = statuses.filter((s) => s === 'PREPARED').length
    const outN = statuses.filter((s) => s === 'DISPATCHED').length
    const detail = [
      t.platform ? `PF ${t.platform}` : null,
      t.effectiveArrival ? `ETA ${formatTimeIST(t.effectiveArrival)}` : null,
      t.delayMinutes && t.delayMinutes > 5 ? `${t.delayMinutes} min late` : null,
      `${run.orders.length} order${run.orders.length === 1 ? '' : 's'}`,
      outN || readyN ? `${outN} out, ${readyN} ready` : null,
    ]
      .filter(Boolean)
      .join(' · ')
    return {
      key: run.key,
      label: runTrainLabel(run),
      name: run.trainName,
      station: run.stationCode,
      etaIso: t.effectiveArrival?.toISOString() ?? null,
      arrived: t.arrived,
      detail,
      word,
      href: `/v2/kitchen#${encodeURIComponent(run.key)}`,
    }
  })

  const riderRows = [...riders.riders]
    .sort((a, b) => b.work.carrying - a.work.carrying || presenceRank(a.presence) - presenceRank(b.presence))
    .slice(0, 4)

  const pct = total ? Math.round(((ready + out + delivered) / total) * 100) : 0

  return (
    <div className="grid gap-[18px]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[30px] font-bold tracking-[-0.03em]">{isToday ? 'Today' : formatServiceDate(day)}</h1>
          <p className="mt-1 text-sm text-v2-muted">
            {isToday ? formatServiceDate(today) : 'Figures for this service day'} · {board.runs.length} train{board.runs.length === 1 ? '' : 's'} · {total} order{total === 1 ? '' : 's'}
            {ingest.stale ? (
              <>
                {' · '}
                <Link href="/v2/inbox" className="font-semibold text-v2-bad underline-offset-2 hover:underline">
                  email ingestion has stopped
                </Link>
              </>
            ) : (
              ' · ingestion healthy'
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DayPicker value={day} today={today} />
          <ButtonLink href="/v2/orders/new" variant="primary">
            <Plus size={16} strokeWidth={2.2} aria-hidden />
            New order
          </ButtonLink>
          <ButtonLink href="/admin/orders/export">Export</ButtonLink>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <Stat hero label="Live orders" value={live} href="/v2/orders">
          <Pill>{delta >= 0 ? `+${delta}` : delta}</Pill>
          {delta >= 0 ? 'more' : 'fewer'} than the day before
        </Stat>
        <Stat label="Ready to leave" value={ready} href="/v2/kitchen">
          {next?.leaveByIso ? (
            <>
              <Pill>{next.counts.ready}</Pill>
              on <Mono>{next.trainLabel}</Mono> · leave by <Mono>{formatTimeIST(next.leaveByIso)}</Mono>
            </>
          ) : (
            'nothing waiting at the counter'
          )}
        </Stat>
        <Stat label="Out for delivery" value={out} href="/v2/riders">
          <Pill>{riders.riders.filter((r) => r.work.carrying > 0).length}</Pill>
          riders on the platform
        </Stat>
        <Stat label="Needs attention" value={attention} href={cancelRequests.length ? '/v2/orders' : '/v2/orders?view=returns'} warm={attention > 0}>
          {attention === 0
            ? 'nothing waiting on you'
            : [
                cancelRequests.length ? `${cancelRequests.length} cancel request${cancelRequests.length === 1 ? '' : 's'}` : null,
                returnsPending ? `${returnsPending} return${returnsPending === 1 ? '' : 's'} to collect` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
        </Stat>
      </div>

      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-[1.5fr_1fr_1fr]">
        <Card title={isToday ? 'Arrivals today' : 'Arrivals'} action={<Chip tone="grey">Orders per hour</Chip>}>
          <div className="grid h-[150px] grid-cols-10 items-end gap-2.5 pt-6">
            {hours.map((h) => {
              const n = perHour.get(h) ?? 0
              const height = n === 0 ? 10 : Math.max(14, Math.round((n / peak) * 100))
              // Another day has no "now": a past day is all solid, a future one all hatched.
              const phase = !isToday ? (day < today ? 'past' : 'future') : h < nowHour ? 'past' : h === nowHour ? 'now' : 'future'
              return (
                <div
                  key={h}
                  className={cx(
                    'relative rounded-full',
                    phase === 'past' && 'bg-v2-brand',
                    phase === 'now' && 'bg-v2-brand-deep',
                    phase === 'future' && 'v2-hatch border border-v2-line-strong',
                    n === 0 && 'opacity-40',
                  )}
                  style={{ height: `${height}%` }}
                  title={`${String(h).padStart(2, '0')}:00 · ${n} order${n === 1 ? '' : 's'}`}
                >
                  {h === peakHour ? (
                    <span className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-v2-line bg-v2-surface-2 px-1.5 font-mono text-[11px] text-v2-ink-2">
                      {String(h).padStart(2, '0')}:00 · {n}
                    </span>
                  ) : null}
                </div>
              )
            })}
          </div>
          <div className="grid grid-cols-10 gap-2.5 text-center font-mono text-xs text-v2-muted">
            {hours.map((h) => (
              <span key={h}>{String(h).padStart(2, '0')}</span>
            ))}
          </div>
          <Legend
            items={[
              { swatch: 'bg-v2-brand', label: 'Arrived' },
              { swatch: 'bg-v2-brand-deep', label: 'This hour' },
              { swatch: 'v2-hatch border border-v2-line-strong', label: 'Still to come' },
            ]}
          />
        </Card>

        <Card
          title="Next up"
          action={next ? <Countdown targetIso={next.etaIso} arrived={next.arrived} serverNowMs={serverNowMs} /> : null}
        >
          {next ? (
            <>
              <div>
                <div className="font-mono text-[30px] font-semibold leading-none tracking-[-0.02em]">{next.trainLabel}</div>
                <div className="mt-1 text-[15px] font-semibold text-v2-ink-2">{next.trainName ?? next.stationCode}</div>
              </div>
              <div className="flex flex-wrap gap-3.5 text-[13px] text-v2-muted">
                <span>{next.platform ? `PF ${next.platform}` : 'Platform TBA'}</span>
                <span>
                  ETA <Mono>{next.etaIso ? formatTimeIST(next.etaIso) : '—'}</Mono>
                </span>
                <span>
                  {next.counts.total} order{next.counts.total === 1 ? '' : 's'}
                </span>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1.5 text-[13px]">
                <dt className="text-v2-muted">Leave by</dt>
                <dd>
                  <Mono>{next.leaveByIso ? formatTimeIST(next.leaveByIso) : '—'}</Mono>
                  <span className="text-v2-muted"> · {next.walkMinutes} min walk + buffer</span>
                </dd>
                <dt className="text-v2-muted">Ready</dt>
                <dd>
                  {next.counts.ready} of {next.counts.total} · {next.counts.cooking} cooking · {next.counts.fresh} new
                </dd>
              </dl>
              <ButtonLink href={`/v2/kitchen#${encodeURIComponent(next.runKey)}`} variant="primary" className="w-full">
                {next.counts.ready > 0
                  ? `Hand ${next.counts.ready} bag${next.counts.ready === 1 ? '' : 's'} to rider`
                  : 'Open this train'}
              </ButtonLink>
            </>
          ) : (
            <p className="text-sm text-v2-muted">No trains with open orders right now.</p>
          )}
        </Card>

        <Card title="Riders" action={<ButtonLink href="/v2/riders?add=1" size="sm">+ Add</ButtonLink>}>
          {riderRows.length === 0 ? (
            <p className="text-sm text-v2-muted">No riders set up yet.</p>
          ) : (
            <div className="grid gap-3">
              {riderRows.map((r) => {
                const due = r.work.duePaise + r.work.earlierDuePaise
                const state =
                  r.work.carrying > 0
                    ? { tone: 'out' as const, label: 'Delivering' }
                    : r.presence === 'LIVE'
                      ? { tone: 'ok' as const, label: 'Idle' }
                      : r.presence === 'IDLE'
                        ? { tone: 'grey' as const, label: 'Idle' }
                        : { tone: 'grey' as const, label: 'Offline' }
                const line = [
                  r.work.carrying > 0 ? `${r.work.carrying} bag${r.work.carrying === 1 ? '' : 's'}` : null,
                  r.work.trains[0] ? `on ${r.work.trains[0]}` : null,
                  due > 0 ? `${formatRupees(due)} in hand` : null,
                  r.work.carrying === 0 && r.work.lastDeliveredAt ? `last delivered ${formatTimeIST(r.work.lastDeliveredAt)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
                return (
                  <Link key={r.id} href={`/v2/riders/${r.id}`} className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3">
                    <Avatar name={r.name} />
                    <span className="min-w-0">
                      <b className="block truncate text-sm font-bold leading-tight">{r.name}</b>
                      <small className="block truncate text-xs text-v2-muted">{line || 'No activity today'}</small>
                    </span>
                    <Chip tone={state.tone}>{state.label}</Chip>
                  </Link>
                )
              })}
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-[1.2fr_1fr_0.9fr]">
        <Card title={isToday ? 'Trains today' : 'Trains'} action={<ButtonLink href="/v2/orders?group=1" size="sm">Grouped view</ButtonLink>}>
          {trainRows.length === 0 ? (
            <p className="text-sm text-v2-muted">No orders for today yet. New orders appear here as they arrive.</p>
          ) : (
            <div className="grid gap-3">
              {trainRows.map((t) => (
                <Link key={t.key} href={t.href} className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3">
                  <span className="grid h-10 w-12 place-items-center rounded-xl bg-v2-surface-2 font-mono text-[11px] font-bold tabular-nums text-v2-ink-2">
                    {t.label}
                  </span>
                  <span className="min-w-0">
                    <b className="flex items-center gap-1.5 text-sm font-bold leading-tight">
                      <span className="truncate">{t.name ?? t.station}</span>
                      <Countdown targetIso={t.etaIso} arrived={t.arrived} serverNowMs={serverNowMs} size="sm" />
                    </b>
                    <small className="block truncate text-xs text-v2-muted">{t.detail}</small>
                  </span>
                  <Chip tone={t.word.tone}>{t.word.label}</Chip>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card title="Kitchen progress">
          <Gauge pct={pct} delivered={delivered} out={out} ready={ready} rest={cookingOrNew} closedBadly={closedBadly} total={total} dayWord={isToday ? 'today\u2019s' : 'the day\u2019s'} />
        </Card>

        <Card title="Needs you" action={attention ? <Chip tone="bad">{attention}</Chip> : <Chip tone="ok">Clear</Chip>}>
          {attention === 0 ? (
            <p className="text-sm text-v2-muted">No cancel requests and no bags to collect.</p>
          ) : (
            <div className="grid gap-3">
              {cancelRequests.map((c) => (
                <div key={c.id} className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-v2-bad-bg text-base font-extrabold text-v2-bad">!</span>
                  <span className="min-w-0">
                    <b className="block truncate text-sm font-bold leading-tight">
                      Cancel request · <Mono>{c.externalOrderId}</Mono>
                    </b>
                    <small className="block truncate text-xs text-v2-muted">
                      {c.requestedBy}: {c.reason}
                    </small>
                  </span>
                  <ButtonLink href={`/v2/orders/${c.id}`} size="sm">
                    Decide
                  </ButtonLink>
                </div>
              ))}
              {returns.rows.map((r) => (
                <div key={r.id} className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-v2-warn-bg text-base font-extrabold text-v2-warn">↩</span>
                  <span className="min-w-0">
                    <b className="block truncate text-sm font-bold leading-tight">
                      Return · <Mono>{r.externalOrderId}</Mono>
                    </b>
                    <small className="block truncate text-xs text-v2-muted">
                      {r.trainNo ? `${r.trainNo} · ` : ''}
                      {r.riders[0] ? `with ${r.riders[0]}` : 'no rider'}
                      {r.codPaise ? ` · COD ${formatRupees(r.codPaise)}` : ''}
                    </small>
                  </span>
                  <ButtonLink href="/v2/orders?view=returns" size="sm">
                    Collect
                  </ButtonLink>
                </div>
              ))}
              {returnsPending > returns.rows.length ? (
                <Link href="/v2/orders?view=returns" className="text-center text-xs font-semibold text-v2-brand">
                  {returnsPending - returns.rows.length} more return{returnsPending - returns.rows.length === 1 ? '' : 's'}
                </Link>
              ) : null}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function presenceRank(p: string): number {
  return p === 'LIVE' ? 0 : p === 'IDLE' ? 1 : p === 'OFFLINE' ? 2 : 3
}

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="rounded-md border border-current/40 px-1.5 font-mono text-[11px] tabular-nums">{children}</span>
}

function Stat({
  label,
  value,
  href,
  hero,
  warm,
  children,
}: {
  label: string
  value: number
  href: string
  hero?: boolean
  warm?: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className={cx(
        'relative grid gap-3 overflow-hidden rounded-v2-lg border p-[18px] transition-colors',
        hero ? 'border-v2-brand-deep bg-v2-brand-deep text-white' : 'border-v2-line bg-v2-surface hover:bg-v2-surface-2',
      )}
    >
      {hero ? (
        <span
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full bg-[radial-gradient(circle,rgba(143,220,180,0.35),rgba(143,220,180,0)_65%)]"
        />
      ) : null}
      <span className="flex items-center justify-between text-[15px] font-semibold">
        {label}
        <span className={cx('grid h-[30px] w-[30px] place-items-center rounded-full border', hero ? 'border-white/35' : 'border-v2-line-strong')}>
          <ArrowUpRight size={14} strokeWidth={2} aria-hidden />
        </span>
      </span>
      <span className={cx('text-[44px] font-bold leading-none tracking-[-0.04em] tabular-nums', warm && !hero && 'text-v2-urgent')}>{value}</span>
      <span className={cx('flex flex-wrap items-center gap-2 text-[12.5px]', hero ? 'text-v2-mint' : 'text-v2-muted')}>{children}</span>
    </Link>
  )
}

function Legend({ items }: { items: { swatch: string; label: string }[] }) {
  return (
    <div className="flex flex-wrap gap-3.5 text-[12.5px] text-v2-ink-2">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className={cx('inline-block h-3 w-3 rounded-full', i.swatch)} aria-hidden />
          {i.label}
        </span>
      ))}
    </div>
  )
}

/**
 * Half-ring of today's orders by stage. Solid segments are done or nearly so;
 * the hatched remainder is still in the kitchen. Drawn with stroke-dasharray
 * on one arc of length ~314 (radius 100), largest stage at the back.
 */
function Gauge({
  pct,
  delivered,
  out,
  ready,
  rest,
  closedBadly,
  total,
  dayWord,
}: {
  pct: number
  delivered: number
  out: number
  ready: number
  rest: number
  closedBadly: number
  total: number
  dayWord: string
}) {
  const ARC = 314
  const seg = (n: number) => (total ? (n / total) * ARC : 0)
  const doneLen = seg(delivered)
  const outLen = doneLen + seg(out)
  const readyLen = outLen + seg(ready)
  return (
    <>
      <div className="grid place-items-center gap-1.5">
        <svg viewBox="0 0 240 130" className="h-auto w-full max-w-[240px]" role="img" aria-label={`${pct} percent of today's orders are ready or beyond`}>
          <defs>
            <pattern id="v2-gauge-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="2" height="8" fill="var(--color-v2-line-strong)" />
            </pattern>
          </defs>
          <path d="M20 120 A100 100 0 0 1 220 120" fill="none" stroke="url(#v2-gauge-hatch)" strokeWidth="26" strokeLinecap="round" />
          {/* A zero-length dash still draws its round cap as a dot, so empty segments are skipped. */}
          {readyLen > 0 ? <path d="M20 120 A100 100 0 0 1 220 120" fill="none" stroke="var(--color-v2-mint)" strokeWidth="26" strokeLinecap="round" strokeDasharray={`${readyLen} ${ARC}`} /> : null}
          {outLen > 0 ? <path d="M20 120 A100 100 0 0 1 220 120" fill="none" stroke="var(--color-v2-brand)" strokeWidth="26" strokeLinecap="round" strokeDasharray={`${outLen} ${ARC}`} /> : null}
          {doneLen > 0 ? <path d="M20 120 A100 100 0 0 1 220 120" fill="none" stroke="var(--color-v2-brand-deep)" strokeWidth="26" strokeLinecap="round" strokeDasharray={`${doneLen} ${ARC}`} /> : null}
        </svg>
        <div className="-mt-[54px] text-[40px] font-bold leading-none tracking-[-0.04em] tabular-nums">{pct}%</div>
        <div className="text-[13px] text-v2-muted">of {dayWord} {total} orders are ready or beyond</div>
      </div>
      <Legend
        items={[
          { swatch: 'bg-v2-brand-deep', label: `Delivered ${delivered}` },
          { swatch: 'bg-v2-brand', label: `Out ${out}` },
          { swatch: 'bg-v2-mint', label: `Ready ${ready}` },
          { swatch: 'v2-hatch border border-v2-line-strong', label: `Cooking or new ${rest}` },
          ...(closedBadly ? [{ swatch: 'bg-v2-bad-bg border border-v2-bad', label: `Cancelled or failed ${closedBadly}` }] : []),
        ]}
      />
    </>
  )
}
