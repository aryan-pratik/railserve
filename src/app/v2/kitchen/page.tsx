import Link from 'next/link'
import { Monitor, MoreHorizontal, Plus } from 'lucide-react'
import { requirePermission } from '@/lib/session'
import { env } from '@/lib/env'
import { formatServiceDate, shiftServiceDate, todayIST } from '@/lib/format'
import { kitchenHref, loadKitchenBoard, parseKitchenQuery } from '@/lib/v2/kitchen'
import { KITCHEN_STATUS_FILTERS } from '@/lib/v2/kitchenView'
import { ButtonLink, cx } from '@/components/v2/ui'
import { EmptyState, Pagination, readPaging } from '@/components/v2/Table'
import { KitchenRun } from '@/components/v2/KitchenRun'
import { KitchenWall } from '@/components/v2/KitchenWall'
import { KitchenLive, KitchenStaleNotice } from '@/components/v2/KitchenLive'
import { KitchenCancellations } from '@/components/v2/KitchenCancellations'
import { KitchenFilters } from '@/components/v2/KitchenFilters'
import { DayPicker } from '@/components/v2/DayPicker'
import { MenuButton } from '@/components/v2/Floating'
import { RememberList } from '@/components/v2/ListMemory'

export const metadata = { title: 'Kitchen · RailServe' }

/** The status filters in the words a kitchen uses. */
const STAGE_LABEL: Record<string, string> = {
  live: 'To cook',
  platform: 'With rider',
  returned: 'Cancelled or returned',
  delivered: 'Delivered',
}

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
  const ctx = await requirePermission('kitchen.operate')
  const sp = await props.searchParams
  const isAdmin = ctx.role === 'ADMIN'
  const wall = sp.wall === '1'
  const { page, pageSize, skip } = readPaging(sp)

  const now = new Date()
  const today = todayIST(now)
  // A store manager opens on what is left to cook, so finished trains do not
  // crowd the list on a busy day; "All orders" is one tap away.
  const parsed = parseKitchenQuery(sp, isAdmin, today)
  const q = !isAdmin && !('status' in sp) ? { ...parsed, statusKey: 'live' } : parsed
  // Bags coming back are in the bell; problems with live times in the warning icon.
  const board = await loadKitchenBoard(ctx, q, now)
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

  return (
    <div className="grid gap-[18px]">
      <RememberList />
      {/* Two short rows: the day and the few controls, then what to show. */}
      <div className="grid gap-3">
        <div className="flex items-center gap-3">
          <h1 className="sr-only text-[26px] font-bold tracking-[-0.03em] sm:not-sr-only">Kitchen</h1>
          <DayPicker value={q.date ?? (q.day === 'yesterday' ? shiftServiceDate(today, -1) : today)} today={today} label="Day" resetKeys={['page', 'day']} />
          <span className="ml-auto flex items-center gap-2">
            <KitchenLive renderedAt={board.loadedAtIso} compact />
            <MenuButton
              label={<MoreHorizontal size={18} aria-hidden />}
              ariaLabel="More"
              buttonClassName="grid h-10 w-10 place-items-center rounded-full border border-v2-line-strong text-v2-ink-2 hover:bg-v2-surface-2"
              panelClassName="min-w-[15rem]"
            >
              <Link href={kitchenHref(base, { day: 'upcoming', date: null, page: 1 })} className="rounded-v2-sm px-3 py-2 text-sm font-semibold hover:bg-v2-surface-2">
                Orders booked for later days{board.dayCounts.upcoming ? ` (${board.dayCounts.upcoming})` : ''}
              </Link>
              <Link href={kitchenHref(base, { wall: true, page: 1 })} className="flex items-center gap-2 rounded-v2-sm px-3 py-2 text-sm font-semibold hover:bg-v2-surface-2">
                <Monitor size={15} aria-hidden /> Big screen for the kitchen wall
              </Link>
            </MenuButton>
            <ButtonLink href="/v2/orders/new" variant="primary" className="h-10 w-10 !px-0" aria-label="New order" title="New order">
              <Plus size={19} strokeWidth={2.4} className="shrink-0" aria-hidden />
            </ButtonLink>
          </span>
        </div>

        <nav className="-mx-1 flex max-w-full gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]" aria-label="Show orders">
          {[{ key: '', label: 'All orders' }, ...KITCHEN_STATUS_FILTERS.map((f) => ({ key: f.key, label: STAGE_LABEL[f.key] ?? f.label }))].map((f) => {
            const active = (q.statusKey ?? '') === f.key
            return (
              <Link
                key={f.key}
                href={kitchenHref(base, { statusKey: f.key || null, page: 1 })}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'inline-flex h-9 shrink-0 items-center rounded-full border px-3.5 text-[14px] font-semibold transition-colors',
                  active ? 'border-v2-ink bg-v2-ink text-v2-bg' : 'border-v2-line-strong text-v2-ink-2 hover:bg-v2-surface-2',
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
