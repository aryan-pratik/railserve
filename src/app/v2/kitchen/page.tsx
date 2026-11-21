import Link from 'next/link'
import { Monitor, Plus } from 'lucide-react'
import { requireRole } from '@/lib/session'
import { env } from '@/lib/env'
import { formatIST, formatServiceDate, shiftServiceDate, todayIST } from '@/lib/format'
import { isSimulatedProvider } from '@/lib/train'
import { countPendingReturns } from '@/lib/repo/rtoRepo'
import { kitchenHref, loadKitchenBoard, parseKitchenQuery } from '@/lib/v2/kitchen'
import { KITCHEN_DAYS, KITCHEN_STATUS_FILTERS } from '@/lib/v2/kitchenView'
import type { TrainFeedHealth } from '@/lib/train/service'
import { ButtonLink, cx } from '@/components/v2/ui'
import { EmptyState, Notice, PageHeader, Pagination, PillTabs, readPaging } from '@/components/v2/Table'
import { KitchenRun } from '@/components/v2/KitchenRun'
import { KitchenWall } from '@/components/v2/KitchenWall'
import { KitchenLive, KitchenStaleNotice } from '@/components/v2/KitchenLive'
import { KitchenCancellations } from '@/components/v2/KitchenCancellations'
import { KitchenFilters } from '@/components/v2/KitchenFilters'
import { DayPicker } from '@/components/v2/DayPicker'

export const metadata = { title: 'Kitchen board · RailServe' }

/**
 * The kitchen board: one strip per train, ordered by when the train actually
 * arrives, with every order on it and the one next step underneath. A train
 * running 90 minutes late drops below one that is on time, because the food
 * that leaves first is the food that should be cooked first.
 *
 * `?wall=1` draws the same runs as a dark full-screen board for the kitchen
 * wall. Admins see every outlet with a station / outlet filter; a store
 * manager sees their own.
 */
export default async function KitchenBoardPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireRole('STORE_MANAGER', 'ADMIN')
  const sp = await props.searchParams
  const isAdmin = ctx.role === 'ADMIN'
  const wall = sp.wall === '1'
  const { page, pageSize, skip } = readPaging(sp)

  const now = new Date()
  const today = todayIST(now)
  const q = parseKitchenQuery(sp, isAdmin, today)
  const [board, pendingReturns] = await Promise.all([loadKitchenBoard(ctx, q, now), countPendingReturns(ctx)])
  const filter = KITCHEN_STATUS_FILTERS.find((f) => f.key === q.statusKey) ?? null
  // A picked day shows that service day; the tabs are the shortcuts around it.
  const dayNote = q.date
    ? formatServiceDate(q.date)
    : q.day === 'upcoming'
      ? 'Orders booked for a later date'
      : q.day === 'yesterday'
        ? `Yesterday · ${formatServiceDate(shiftServiceDate(today, -1))}`
        : formatServiceDate(today)

  const base = { ...q, wall, page, pageSize }
  const deskHref = kitchenHref({ ...q, page, pageSize }, { wall: false })

  if (wall) {
    return (
      <>
        <KitchenWall
          runs={board.runs}
          riders={board.riders}
          serverNowMs={board.serverNowMs}
          renderedAt={board.loadedAtIso}
          delayThresholdMinutes={env.KOT_DELAY_THRESHOLD_MINUTES}
          deskHref={deskHref}
          title={`Kitchen · ${dayNote}${filter ? ` · ${filter.label}` : ''}`}
        />
        <KitchenCancellations />
      </>
    )
  }

  // A page of the board is a page of whole trains, never half a train: the
  // footer acts on the whole run, and a run split across pages would act on
  // orders out of sight.
  const total = board.runs.length
  const pageRuns = board.runs.slice(skip, skip + pageSize)
  const totalOrders = board.runs.reduce((n, r) => n + r.orders.length, 0)

  return (
    <div className="grid gap-[18px]">
      <PageHeader
        title="Kitchen board"
        note={
          <>
            {dayNote} · {total} train{total === 1 ? '' : 's'} · {totalOrders} order{totalOrders === 1 ? '' : 's'}
          </>
        }
        actions={
          <>
            <KitchenLive renderedAt={board.loadedAtIso} />
            <ButtonLink href={kitchenHref(base, { wall: true, page: 1 })} title="Full-screen board for the kitchen wall">
              <Monitor size={16} strokeWidth={2} aria-hidden />
              Wall
            </ButtonLink>
            <ButtonLink href="/v2/orders/new" variant="primary">
              <Plus size={16} strokeWidth={2.2} aria-hidden />
              New order
            </ButtonLink>
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <PillTabs
            tabs={KITCHEN_DAYS.map((d) => ({
              href: kitchenHref(base, { day: d.key, date: null, page: 1 }),
              label: d.label,
              count: board.dayCounts[d.key],
              active: !q.date && q.day === d.key,
            }))}
          />
          <DayPicker value={q.date ?? (q.day === 'yesterday' ? shiftServiceDate(today, -1) : today)} today={today} label="Service day" resetKeys={['page', 'day']} />
        </div>
        <nav className="flex flex-wrap gap-1" aria-label="Order status">
          {[...KITCHEN_STATUS_FILTERS.map((f) => ({ key: f.key, label: f.label })), { key: '', label: 'All' }].map((f) => {
            const active = (q.statusKey ?? '') === f.key
            return (
              <Link
                key={f.key}
                href={kitchenHref(base, { statusKey: f.key || null, page: 1 })}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'rounded-full px-3 py-1 text-[12.5px] font-semibold transition-colors',
                  active ? 'bg-v2-ink text-v2-bg' : 'text-v2-ink-2 hover:bg-v2-surface-2',
                )}
              >
                {f.label}
              </Link>
            )
          })}
        </nav>
      </div>

      {isAdmin ? (
        <KitchenFilters
          key={`${q.stationCode ?? ''}-${q.outletId ?? ''}`}
          stations={board.stations}
          outlets={board.outlets}
          current={{ station: q.stationCode, outlet: q.outletId }}
          carry={{ day: q.day === 'today' ? '' : q.day, date: q.date ?? '', status: q.statusKey ?? '', pageSize: pageSize === 20 ? '' : String(pageSize) }}
          clearHref={kitchenHref(base, { stationCode: null, outletId: null, page: 1 })}
        />
      ) : null}

      <KitchenStaleNotice renderedAt={board.loadedAtIso} />
      <FeedNotice simulated={isSimulatedProvider()} health={board.feedHealth} onBoard={board.runs.map((r) => r.trainNo).filter((t): t is string => !!t)} />
      {pendingReturns > 0 ? (
        <Notice tone="warn">
          {pendingReturns} bag{pendingReturns === 1 ? '' : 's'} on the way back to the counter.{' '}
          <Link href="/v2/orders?view=returns" className="font-bold underline underline-offset-2">
            Open returns
          </Link>
        </Notice>
      ) : null}

      {total === 0 ? (
        filter || q.outletId || q.stationCode ? (
          <EmptyState
            title="No orders match"
            note={`Nothing under ${filter?.label ?? 'this filter'} for this day${q.outletId || q.stationCode ? ' at this outlet' : ''}.`}
            action={<ButtonLink href={kitchenHref(base, { statusKey: null, outletId: null, stationCode: null, page: 1 })}>Show all</ButtonLink>}
          />
        ) : (
          <EmptyState
            title={q.date ? `Nothing on ${formatServiceDate(q.date)}` : q.day === 'upcoming' ? 'Nothing booked ahead' : q.day === 'yesterday' ? 'Nothing from yesterday' : 'No orders yet today'}
            note={
              q.date
                ? 'No orders were booked for this service day at the outlets you see.'
                : q.day === 'upcoming'
                ? 'Bulk orders booked for a later date appear here.'
                : q.day === 'yesterday'
                  ? 'Orders from the previous service day show here, including any still open after midnight.'
                  : 'New orders appear here the moment they arrive, grouped by train.'
            }
            action={
              <ButtonLink href="/v2/orders/new" variant="primary">
                Add one by hand
              </ButtonLink>
            }
          />
        )
      ) : (
        <div className="grid gap-5">
          {pageRuns.map((run) => (
            <KitchenRun
              key={run.key}
              run={run}
              riders={board.riders}
              serverNowMs={board.serverNowMs}
              delayThresholdMinutes={env.KOT_DELAY_THRESHOLD_MINUTES}
              showOutlet={board.showOutlet}
            />
          ))}
        </div>
      )}

      {total > 0 ? (
        <div className="rounded-v2-lg border border-v2-line bg-v2-surface">
          <Pagination page={page} pageSize={pageSize} total={total} buildHref={(t) => kitchenHref(base, t)} />
        </div>
      ) : null}

      <KitchenCancellations />
    </div>
  )
}

/**
 * Says what the arrival times on this board actually are. A board with no
 * notice is claiming live data; each state below means it is not.
 */
function FeedNotice({ simulated, health, onBoard }: { simulated: boolean; health: TrainFeedHealth; onBoard: string[] }) {
  if (simulated) {
    return (
      <Notice tone="warn">
        Train times on this screen are <strong>simulated</strong>, not live. Do not dispatch against them.
      </Notice>
    )
  }
  if (!health.failing) return null
  const lastGood = health.lastSuccessAt ? ` Last live reading ${formatIST(health.lastSuccessAt)}.` : ''
  if (health.failingTrains.length >= health.trainsTried) {
    return (
      <Notice tone="bad">
        <strong>Live train feed is down.</strong> Times are from the timetable.{lastGood}
      </Notice>
    )
  }
  // Only the trains this screen is showing: a failing train on another
  // outlet's board, or on another day, is not this kitchen's problem.
  const trains = health.failingTrains.filter((t) => onBoard.includes(t))
  if (trains.length === 0) return null
  return (
    <Notice tone="warn">
      <strong>
        No live status for {trains.length} of {health.trainsTried} trains.
      </strong>{' '}
      Their times are from the timetable.{lastGood}
      {trains.length > 4 ? (
        <details className="mt-1 text-xs font-normal">
          <summary className="cursor-pointer underline-offset-2 hover:underline">Which trains</summary>
          <span className="mt-1 block font-mono">{trains.join(', ')}</span>
        </details>
      ) : (
        <span className="mt-1 block font-mono text-xs font-normal">{trains.join(', ')}</span>
      )}
    </Notice>
  )
}
