import type { ReactNode } from 'react'
import Link from 'next/link'
import { formatRupees, formatTimeIST } from '@/lib/format'
import type { TimingView } from '@/lib/train/policy'
import { CheckCycle, DelayPill, FeedUpdated, PlatformBadge, StaleFlag } from './TrainTiming'
import { UrgencyRail } from './UrgencyRail'
import { Card, CoachChip, StatusBadge, TypeBadge } from './ui'

/** Lean Mongoose documents type optional fields as `T | null | undefined`. */
type Maybe<T> = T | null | undefined

export type RunOrderRow = {
  id: string
  externalOrderId: string
  orderType: string
  status: string
  coach?: Maybe<string>
  berth?: Maybe<string>
  handoverPoint?: Maybe<string>
  pax?: Maybe<number>
  contactName?: Maybe<string>
  itemCount: number
  amountPaise?: Maybe<number>
  paymentMode?: Maybe<string>
  /** Only set — and only rendered — when the viewer holds more than one outlet. */
  outletName?: Maybe<string>
}

export type RunCardData = {
  key: string
  trainNo?: Maybe<string>
  trainName?: Maybe<string>
  stationCode: string
  timing: TimingView
  orders: RunOrderRow[]
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
}: {
  run: RunCardData
  /** Omit to render rows as plain text — the admin board links, the KOT view does not. */
  orderHref?: (orderId: string) => string
  footer?: ReactNode
}) {
  const codTotal = run.orders
    .filter((o) => o.paymentMode === 'COD')
    .reduce((sum, o) => sum + (o.amountPaise ?? 0), 0)
  const items = run.orders.reduce((sum, o) => sum + o.itemCount, 0)

  const arrivalIso = run.timing.effectiveArrival?.toISOString() ?? null
  // Seeds the rail's first paint; it ticks on its own clock after hydration.
  const serverNow = new Date().toISOString()

  return (
    <Card className="overflow-hidden">
      <div className="flex items-stretch">
        <UrgencyRail at={arrivalIso} serverNow={serverNow} />

        <div className="min-w-0 flex-1">
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
              {run.stationCode} · {run.orders.length} order{run.orders.length === 1 ? '' : 's'}
              {items > 0 ? ` · ${items} item${items === 1 ? '' : 's'}` : ''}
            </span>
            {/*
              Cash to collect, not the gross total. The gross summed prepaid and
              COD together, which is a number nobody acts on — and it sat inches
              from the per-order COD pill as a second unlabelled ₹ figure meaning
              something different. This one is the rider's float.
            */}
            {codTotal > 0 ? (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-amber-900 ring-1 ring-inset ring-amber-200">
                {formatRupees(codTotal)} to collect
              </span>
            ) : null}
          </div>
        </div>

        {/* The rail already carries "how long until"; this is the wall-clock
            time the kitchen writes on a docket, so both earn their place. */}
        <div className="text-right">
          <div className="text-2xl font-bold leading-none tabular-nums text-ink">
            {formatTimeIST(run.timing.effectiveArrival)}
          </div>
          <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">
            <DelayPill delayMinutes={run.timing.delayMinutes} />
            <StaleFlag timing={run.timing} />
            <FeedUpdated at={run.timing.providerUpdatedAt} />
          </div>
          <div className="mt-1 flex justify-end">
            <CheckCycle
              checkedAt={run.timing.checkedAt}
              nextCheckAt={run.timing.nextCheckAt}
              now={new Date(serverNow)}
            />
          </div>
        </div>
      </div>

      <ul className="divide-y divide-line border-t border-line">
        {run.orders.map((o) => {
          const row = (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
              <div className="w-20 shrink-0">
                {o.handoverPoint ? (
                  <span className="text-xs font-semibold text-fuchsia-700">Handover</span>
                ) : (
                  <CoachChip coach={o.coach} berth={o.berth} />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-ink">
                    {o.contactName ?? o.externalOrderId}
                  </span>
                  <TypeBadge type={o.orderType} />
                </div>
                <div className="truncate text-xs text-muted">
                  {o.outletName ? `${o.outletName} · ` : ''}
                  {o.pax ? `${o.pax} pax` : `${o.itemCount} item${o.itemCount === 1 ? '' : 's'}`}
                  {o.handoverPoint ? ` · ${o.handoverPoint}` : ''}
                </div>
              </div>

              {/*
                COD is the one number a rider must not get wrong, so the pill
                says the word. Colour alone carried this before — "amber pill
                means collect cash" lived only in the manager's memory, and the
                first person covering a shift had no way to know it.

                A COD order with no amount is the dangerous case: it used to
                render a confident amber "₹—". It now says what is actually
                true, in red, because a rider needs to ask before they hand food
                over rather than guess at the door.
              */}
              {o.paymentMode === 'COD' ? (
                o.amountPaise == null ? (
                  <span className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-xs font-bold text-red-800 ring-1 ring-inset ring-red-200">
                    COD · amount missing
                  </span>
                ) : (
                  <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-bold tabular-nums text-amber-900 ring-1 ring-inset ring-amber-200">
                    COD {formatRupees(o.amountPaise)}
                  </span>
                )
              ) : (
                <span className="shrink-0 text-xs font-medium text-muted">prepaid</span>
              )}

              <StatusBadge status={o.status} />
            </div>
          )

          return (
            <li key={o.id}>
              {orderHref ? (
                <Link href={orderHref(o.id)} className="block transition hover:bg-sunken">
                  {row}
                </Link>
              ) : (
                row
              )}
            </li>
          )
        })}
      </ul>

      {footer ? <div className="border-t border-line bg-sunken/60 px-4 py-2.5">{footer}</div> : null}
        </div>
      </div>
    </Card>
  )
}
