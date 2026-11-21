import Link from 'next/link'
import { ArrowRight, CheckCircle2, Plus } from 'lucide-react'
import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { UnparsedInbox } from '@/lib/models'
import { listPendingCancelRequests } from '@/lib/repo/cancelRequestRepo'
import { countPendingReturns } from '@/lib/repo/rtoRepo'
import { riderBoard } from '@/lib/repo/riderLocationRepo'
import { checkIngestStaleness } from '@/lib/ingest/gmail/sync'
import { LIVE_STATUSES } from '@/lib/repo/runRepo'
import { runTrainLabel } from '@/lib/runs'
import { formatRupees, formatServiceDate, formatTimeIST, todayIST } from '@/lib/format'
import { loadDay, loadToday } from '@/lib/v2/dashboard'
import { DayPicker } from '@/components/v2/DayPicker'
import { ButtonLink, Card, Chip, cx } from '@/components/v2/ui'
import { Notice } from '@/components/v2/Table'
import { CountdownBand } from '@/components/v2/Countdown'

export const metadata = { title: 'Today · RailServe' }

const LIVE = new Set<string>(LIVE_STATUSES)
/** Orders that did not go ahead: they earn nothing. */
const LOST = new Set(['CANCELLED', 'FAILED', 'LOST', 'MISDELIVERY', 'MISSED_DELIVERY', 'REFUNDED', 'ENQUIRY', 'QUOTED'])

/**
 * The owner's home: in a few seconds, is today going fine, how much has it
 * made, how much cash is still out with riders, and is anything waiting for
 * a decision. Everything else (charts, rider maps, the kitchen detail) lives
 * on its own page, one click away.
 */
export default async function V2AdminDashboard(props: PageProps<'/v2/admin'>) {
  const ctx = await requireRole('ADMIN')
  const sp = await props.searchParams
  await connectDb()

  const now = new Date()
  const serverNowMs = now.getTime()
  const today = todayIST(now)
  const rawDate = Array.isArray(sp.date) ? sp.date[0] : sp.date
  const day = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && rawDate !== today ? rawDate : today
  const isToday = day === today

  const [{ board }, cancelRequests, returnsPending, riders, ingest, emailsToCheck] = await Promise.all([
    isToday ? loadToday(ctx) : loadDay(ctx, day),
    listPendingCancelRequests(ctx, { limit: 5 }),
    countPendingReturns(ctx),
    riderBoard(ctx, { now }),
    checkIngestStaleness(now, ctx.tenantId),
    UnparsedInbox.countDocuments({ tenantId: ctx.tenantId, resolved: false }),
  ])

  const orders = board.runs.flatMap((r) => r.orders)
  const total = orders.length
  const inProgress = orders.filter((o) => LIVE.has(o.status) || o.status === 'DISPATCHED').length
  const going = orders.filter((o) => !LOST.has(o.status))
  const salesPaise = going.reduce((n, o) => n + (o.amountPaise ?? 0), 0)
  const cashPaise = going.filter((o) => o.paymentMode === 'COD').reduce((n, o) => n + (o.amountPaise ?? 0), 0)
  const withRiders = riders.riders.filter((r) => r.work.duePaise + r.work.earlierDuePaise > 0)
  const riderCashPaise = withRiders.reduce((n, r) => n + r.work.duePaise + r.work.earlierDuePaise, 0)

  const waiting = cancelRequests.length + (returnsPending ? 1 : 0) + (emailsToCheck ? 1 : 0)

  const trains = board.runs
    .filter((run) => !isToday || run.orders.some((o) => LIVE.has(o.status) || o.status === 'DISPATCHED'))
    .slice(0, 5)
    .map((run) => {
      const t = board.timingOf(run)
      const s = run.orders.map((o) => o.status)
      const n = (pred: (x: string) => boolean) => s.filter(pred).length
      const fresh = n((x) => x === 'RECEIVED')
      const cooking = n((x) => x === 'ACCEPTED' || x === 'KOT_PRINTED')
      const ready = n((x) => x === 'PREPARED')
      const out = n((x) => x === 'DISPATCHED')
      const word =
        fresh > 0
          ? { tone: 'info' as const, label: `${fresh} new` }
          : cooking > 0
            ? { tone: 'warn' as const, label: 'Cooking' }
            : ready > 0
              ? { tone: 'ok' as const, label: 'Ready' }
              : out > 0
                ? { tone: 'out' as const, label: 'With rider' }
                : { tone: 'grey' as const, label: 'Done' }
      return {
        key: run.key,
        label: runTrainLabel(run),
        name: run.trainName,
        etaIso: t.effectiveArrival?.toISOString() ?? null,
        arrived: t.arrived,
        line: [
          t.effectiveArrival ? `Arrives ${formatTimeIST(t.effectiveArrival)}` : null,
          t.delayMinutes && t.delayMinutes > 5 ? `${t.delayMinutes} min late` : null,
          t.platform ? `Platform ${t.platform}` : null,
          `${run.orders.length} order${run.orders.length === 1 ? '' : 's'}`,
        ]
          .filter(Boolean)
          .join(' · '),
        word,
      }
    })

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[30px] font-bold tracking-[-0.03em]">{isToday ? 'Today' : formatServiceDate(day)}</h1>
          <p className="mt-1 text-[15px] text-v2-muted">{isToday ? formatServiceDate(today) : 'Looking back at this day'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DayPicker value={day} today={today} />
          <ButtonLink href="/v2/orders/new" variant="primary" className="h-10 w-10 !px-0" aria-label="New order" title="New order">
              <Plus size={19} strokeWidth={2.4} className="shrink-0" aria-hidden />
            </ButtonLink>
        </div>
      </div>

      {ingest.stale ? (
        <Notice tone="bad">
          <strong>Orders from email have stopped coming in.</strong> New orders may be missing.{' '}
          <Link href="/v2/inbox" className="font-bold underline underline-offset-2">
            Check emails
          </Link>
        </Notice>
      ) : null}

      {/* What needs the owner, first. When nothing does, one calm line. */}
      {waiting > 0 ? (
        <Card title="Waiting for you" action={<Chip tone="warn">{waiting}</Chip>}>
          <ul className="-mx-1 grid grid-cols-[minmax(0,1fr)] gap-1">
            {cancelRequests.map((c) => (
              <WaitRow
                key={c.id}
                href={`/v2/orders/${c.id}`}
                title="Cancel this order?"
                detail={[c.trainNo ? `Train ${c.trainNo}` : null, c.rawSeat ? `seat ${c.rawSeat}` : null, `"${c.reason}"`].filter(Boolean).join(' · ')}
                action="Decide"
              />
            ))}
            {returnsPending ? (
              <WaitRow
                href="/v2/orders?view=returns"
                title={`${returnsPending} bag${returnsPending === 1 ? ' is' : 's are'} coming back`}
                detail="Not delivered or cancelled. Check them in when they reach the counter."
                action="See bags"
              />
            ) : null}
            {emailsToCheck ? (
              <WaitRow
                href="/v2/inbox"
                title={`${emailsToCheck} email${emailsToCheck === 1 ? '' : 's'} did not become an order`}
                detail="Look at each one and add the order by hand if it is real."
                action="Check"
              />
            ) : null}
          </ul>
        </Card>
      ) : (
        <div className="flex items-center gap-2.5 rounded-v2-lg border border-v2-line bg-v2-surface px-5 py-4 text-[15px] font-semibold">
          <CheckCircle2 size={20} className="text-v2-ok" aria-hidden />
          Nothing is waiting for you.
        </div>
      )}

      <div className="grid gap-3.5 sm:grid-cols-3">
        <BigNumber
          href="/v2/orders"
          label={isToday ? 'Orders today' : 'Orders'}
          value={String(total)}
          note={isToday ? (inProgress ? `${inProgress} still in progress` : 'All finished') : `${going.length} went ahead`}
        />
        <BigNumber href="/v2/analytics" label={isToday ? 'Sales today' : 'Sales'} value={formatRupees(salesPaise)} note={cashPaise ? `${formatRupees(cashPaise)} of it in cash` : 'All paid online'} />
        <BigNumber
          href="/v2/riders"
          label="Cash with riders"
          value={formatRupees(riderCashPaise)}
          note={withRiders.length ? `${withRiders.length} rider${withRiders.length === 1 ? '' : 's'} still to hand it in` : 'All handed in'}
          warm={riderCashPaise > 0}
        />
      </div>

      <Card
        title={isToday ? 'Next trains' : 'Trains'}
        action={
          <Link href="/v2/orders?group=1" className="inline-flex items-center gap-1 text-sm font-semibold text-v2-brand hover:underline">
            All trains <ArrowRight size={15} aria-hidden />
          </Link>
        }
      >
        {trains.length === 0 ? (
          <p className="text-[15px] text-v2-muted">{isToday ? 'No more trains to serve today.' : 'No trains on this day.'}</p>
        ) : (
          <ul className="-mx-1 grid grid-cols-[minmax(0,1fr)] gap-1.5">
            {trains.map((t) => (
              <li key={t.key}>
                <Link
                  href="/v2/orders?group=1"
                  className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-stretch overflow-hidden rounded-v2-md border border-v2-line transition-colors hover:bg-v2-surface-2"
                >
                  <CountdownBand targetIso={t.etaIso} arrived={t.arrived} serverNowMs={serverNowMs} />
                  <span className="min-w-0 px-3.5 py-2.5">
                    <span className="block truncate text-[15px] font-semibold">
                      <span className="font-mono">{t.label}</span> {t.name ?? ''}
                    </span>
                    <span className="block truncate text-[13.5px] text-v2-muted">{t.line}</span>
                  </span>
                  <span className="flex items-center pr-3.5">
                    <Chip tone={t.word.tone}>{t.word.label}</Chip>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function WaitRow({ href, title, detail, action }: { href: string; title: string; detail: string; action: string }) {
  return (
    <li>
      <Link href={href} className="flex min-w-0 items-center gap-3 rounded-v2-md px-3 py-2.5 transition-colors hover:bg-v2-surface-2">
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">{title}</span>
          <span className="block truncate text-[13.5px] text-v2-muted">{detail}</span>
        </span>
        <span className="shrink-0 rounded-full border border-v2-line-strong px-3.5 py-1.5 text-[13.5px] font-semibold">{action}</span>
      </Link>
    </li>
  )
}

function BigNumber({ href, label, value, note, warm }: { href: string; label: string; value: string; note: string; warm?: boolean }) {
  return (
    <Link href={href} className="grid gap-1.5 rounded-v2-lg border border-v2-line bg-v2-surface p-5 transition-colors hover:bg-v2-surface-2">
      <span className="text-[15px] font-semibold text-v2-ink-2">{label}</span>
      <span className={cx('text-[34px] font-bold leading-none tracking-[-0.03em] tabular-nums', warm && 'text-v2-cod')}>{value}</span>
      <span className="text-[13.5px] text-v2-muted">{note}</span>
    </Link>
  )
}
