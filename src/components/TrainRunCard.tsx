import type { ReactNode } from 'react'
import Link from 'next/link'
import { formatRupees, formatTimeIST } from '@/lib/format'
import type { TimingView } from '@/lib/train/policy'
import { CheckCycle, DelayPill, FeedUpdated, PlatformBadge, StaleFlag } from './TrainTiming'
import { UrgencyRail } from './UrgencyRail'
import { Card, CoachChip, StatusBadge, TypeBadge, focusRingInset } from './ui'
import { IconChevronDown } from './Icons'
import { CopyButton } from './CopyButton'
import { urgencyBand, type UrgencyBand } from '@/lib/urgency'

/** A header band tinted by urgency, so a board can be scanned by colour before it is read. */
const HEADER_TINT: Record<UrgencyBand, string> = {
  red: 'bg-red-50 hover:bg-red-100/70',
  amber: 'bg-amber-50 hover:bg-amber-100/70',
  green: 'bg-emerald-50 hover:bg-emerald-100/70',
  none: 'bg-sunken/70 hover:bg-sunken',
}
import { CallNoteHint } from './CallNoteHint'

/** Lean Mongoose documents type optional fields as `T | null | undefined`. */
type Maybe<T> = T | null | undefined

export type RunOrderRow = {
  id: string
  externalOrderId: string
  orderType: string
  status: string
  coach?: Maybe<string>
  berth?: Maybe<string>
  rawSeat?: Maybe<string>
  handoverPoint?: Maybe<string>
  pax?: Maybe<number>
  contactName?: Maybe<string>
  itemCount: number
  amountPaise?: Maybe<number>
  paymentMode?: Maybe<string>
  /** Only set, and only rendered, when the viewer holds more than one outlet. */
  outletName?: Maybe<string>
  /** Call-note count and prebuilt tooltip text — see callNoteSummary. */
  callNoteCount?: Maybe<number>
  callNoteHint?: Maybe<string>
}

export type RunCardData = {
  key: string
  trainNo?: Maybe<string>
  trainName?: Maybe<string>
  stationCode: string
  timing: TimingView
  orders: RunOrderRow[]
}

/** The train-level facts every run card carries, whoever is looking at it. */
export type RunHeaderData = {
  trainNo?: Maybe<string>
  trainName?: Maybe<string>
  stationCode: string
  timing: TimingView
}

/**
 * The shell of a train card: urgency rail, train, actual arrival, delay and
 * feed freshness, with the caller's own rows underneath.
 *
 * Shared so the kitchen board and the call board cannot drift apart on how a
 * train's timing reads. What differs between them is only the rows, and
 * `codTotal`: it is money, so a caller that must not show any simply omits it.
 *
 * `collapsible` turns the header into a button that folds the rows away, for a
 * board with more trains than fit on a screen. It is a native <details>, so it
 * opens from the keyboard, announces its state, and keeps its open/closed
 * state across the board's own refresh. The header then sits on a tinted band
 * and the passengers on white below it, so a train reads as one section and
 * two trains never blur into a single stack of boxes.
 */
export function TrainRunFrame({
  run,
  orderCount,
  itemCount,
  codTotal = 0,
  children,
  footer,
  headerNote,
  refreshAction,
  collapsible,
  copyText,
}: {
  run: RunHeaderData
  orderCount: number
  itemCount: number
  /** Cash to collect on this run, in paise. Omit where money is not shown. */
  codTotal?: number
  /** The `<li>` rows. */
  children: ReactNode
  footer?: ReactNode
  /** A line under the train's count, inside the header so it survives being collapsed. */
  headerNote?: ReactNode
  /** "Check now" for this train, on the surfaces that offer it. */
  refreshAction?: ReactNode
  /** Render as a foldable section. `open` is only the starting state. */
  collapsible?: { open: boolean }
  /** Plain text for the header's "Copy train details" button. Omit to hide it. */
  copyText?: string
}) {
  const arrivalIso = run.timing.effectiveArrival?.toISOString() ?? null
  // Seeds the rail's first paint; it ticks on its own clock after hydration.
  const serverNow = new Date().toISOString()
  const band = urgencyBand(
    run.timing.effectiveArrival
      ? (run.timing.effectiveArrival.getTime() - new Date(serverNow).getTime()) / 60_000
      : null,
  )

  const headerBody = (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 px-4 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-mono text-lg font-bold tabular-nums tracking-tight text-ink">
            {run.trainNo ?? 'No train no.'}
          </span>
          <span className="truncate text-sm font-medium text-muted">{run.trainName}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <PlatformBadge platform={run.timing.platform} />
          <span className="text-xs text-muted">
            {run.stationCode} · {orderCount} order{orderCount === 1 ? '' : 's'}
            {itemCount > 0 ? ` · ${itemCount} item${itemCount === 1 ? '' : 's'}` : ''}
          </span>
          {/* Cash to collect, not the gross total: this one is the rider's float. */}
          {codTotal > 0 ? (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-amber-900 ring-1 ring-inset ring-amber-200">
              {formatRupees(codTotal)} to collect
            </span>
          ) : null}
        </div>
        {headerNote ? <div className="mt-2">{headerNote}</div> : null}
      </div>

      {/* The rail already carries "how long until"; this is the wall-clock
          time the kitchen writes on a docket, so both earn their place. */}
      <div className="sm:text-right">
        <div className="text-2xl font-bold leading-none tabular-nums text-ink">
          {formatTimeIST(run.timing.effectiveArrival)}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5 sm:justify-end">
          <DelayPill delayMinutes={run.timing.delayMinutes} />
          <StaleFlag timing={run.timing} />
          <FeedUpdated at={run.timing.providerUpdatedAt} />
        </div>
        <div className="mt-1 flex items-center gap-1 sm:justify-end">
          <CheckCycle
            checkedAt={run.timing.checkedAt}
            nextCheckAt={run.timing.nextCheckAt}
            now={new Date(serverNow)}
            arrived={run.timing.arrived}
          />
          {refreshAction}
          {copyText ? <CopyButton text={copyText} label="Copy train details" /> : null}
        </div>
      </div>
    </div>
  )

  const rail = <UrgencyRail at={arrivalIso} serverNow={serverNow} />

  if (collapsible) {
    return (
      <Card className="overflow-hidden">
        <details open={collapsible.open} data-train-section className="group">
          <summary
            className={`flex cursor-pointer list-none items-stretch transition-colors ${HEADER_TINT[band]} ${focusRingInset} [&::-webkit-details-marker]:hidden`}
          >
            {rail}
            <div className="min-w-0 flex-1">{headerBody}</div>
            <IconChevronDown
              size={18}
              aria-hidden
              className="mx-3 self-center text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none"
            />
          </summary>
          <ul className="divide-y divide-line border-t border-line-strong/60 bg-surface">{children}</ul>
          {footer ? <div className="border-t border-line bg-sunken/60 px-4 py-2.5">{footer}</div> : null}
        </details>
      </Card>
    )
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-stretch">
        {rail}

        <div className="min-w-0 flex-1">
          {headerBody}

          <ul className="divide-y divide-line border-t border-line">{children}</ul>

          {footer ? <div className="border-t border-line bg-sunken/60 px-4 py-2.5">{footer}</div> : null}
        </div>
      </div>
    </Card>
  )
}

/**
 * Everything shown in an order row, as plain text for pasting elsewhere —
 * the kitchen board's equivalent of TrainGroups' `orderDetailsText`.
 */
function orderDetailsText(o: RunOrderRow, run: RunHeaderData): string {
  const seat = o.handoverPoint
    ? `Handover: ${o.handoverPoint}`
    : [o.coach, o.berth, o.rawSeat].filter(Boolean).join(' ') || '-'
  const lines = [
    `Order ${o.externalOrderId} (${o.orderType})`,
    `Passenger: ${o.contactName ?? '-'}`,
    `Seat: ${seat}`,
    o.pax ? `Pax: ${o.pax}` : `Items: ${o.itemCount}`,
    o.amountPaise != null
      ? `Amount: ${formatRupees(o.amountPaise)}${o.paymentMode ? ` (${o.paymentMode})` : ''}`
      : o.paymentMode
        ? `Payment: ${o.paymentMode}`
        : null,
    `Status: ${o.status}`,
    `Train: ${run.trainNo ?? 'No train no.'} ${run.trainName ?? ''} · ${run.stationCode}`.trim(),
  ]
  return lines.filter((l): l is string => Boolean(l)).join('\n')
}

/**
 * One train, every order on it.
 *
 * The train is the unit of work: one rider takes the whole run to the platform
 * in one trip, so grouping orders any other way makes the kitchen assemble a
 * trip that nobody actually walks.
 */
export function TrainRunCard({
  run,
  orderHref,
  footer,
  refreshAction,
}: {
  run: RunCardData
  /** Omit to render rows as plain text. */
  orderHref?: (orderId: string) => string
  footer?: ReactNode
  /** "Check now" for this train, on the surfaces that offer it. */
  refreshAction?: ReactNode
}) {
  const codTotal = run.orders
    .filter((o) => o.paymentMode === 'COD')
    .reduce((sum, o) => sum + (o.amountPaise ?? 0), 0)
  const items = run.orders.reduce((sum, o) => sum + o.itemCount, 0)

  return (
    <TrainRunFrame
      run={run}
      orderCount={run.orders.length}
      itemCount={items}
      codTotal={codTotal}
      footer={footer}
      refreshAction={refreshAction}
      copyText={`${run.trainNo ?? 'No train no.'} ${run.trainName ?? ''} · ${run.stationCode}`.trim()}
    >
      {run.orders.map((o) => {
        // The name block keeps a minimum width, so on a phone the
        // badges wrap under it rather than squeezing it to "Khil…".
        const row = (
          <div className="group flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
            <div className="w-20 shrink-0">
              {o.handoverPoint ? (
                <span className="text-xs font-semibold text-fuchsia-700">Handover</span>
              ) : (
                <CoachChip coach={o.coach} berth={o.berth} rawSeat={o.rawSeat} />
              )}
            </div>

            <div className="min-w-[10rem] flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium text-ink">
                  {o.contactName ?? o.externalOrderId}
                </span>
                <TypeBadge type={o.orderType} />
                <CallNoteHint orderId={o.id} count={o.callNoteCount} hint={o.callNoteHint} />
              </div>
              <div className="truncate text-xs text-muted">
                {o.outletName ? `${o.outletName} · ` : ''}
                {o.pax ? `${o.pax} pax` : `${o.itemCount} item${o.itemCount === 1 ? '' : 's'}`}
                {o.handoverPoint ? ` · ${o.handoverPoint}` : ''}
              </div>
            </div>

            <div className="ml-auto flex items-center gap-2">
              {/* COD is the one number a rider must not get wrong, so the
                  pill says the word. A COD order with no amount is the
                  dangerous case and says so in red. */}
              {o.paymentMode === 'COD' ? (
                o.amountPaise == null ? (
                  <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-bold text-red-800 ring-1 ring-inset ring-red-200">
                    COD · amount missing
                  </span>
                ) : (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-bold tabular-nums text-amber-900 ring-1 ring-inset ring-amber-200">
                    COD {formatRupees(o.amountPaise)}
                  </span>
                )
              ) : (
                <span className="text-xs font-medium text-muted">prepaid</span>
              )}
              <StatusBadge status={o.status} />
              <span className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
                <CopyButton text={orderDetailsText(o, run)} label="Copy order details" />
              </span>
            </div>
          </div>
        )

        return (
          <li key={o.id}>
            {orderHref ? (
              <Link href={orderHref(o.id)} className="block transition-colors hover:bg-sunken">
                {row}
              </Link>
            ) : (
              row
            )}
          </li>
        )
      })}
    </TrainRunFrame>
  )
}
