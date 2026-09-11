'use client'

import { useState } from 'react'
import { useNowMs } from '@/components/useNow'
import { formatRupees } from '@/lib/format'
import { Card, CoachChip, Dash, PaymentBadge, StatusBadge, TypeBadge, focusRingInset, thClass } from '@/components/ui'
import { IconChevronDown } from '@/components/Icons'
import { OrderSlideOver, type OrderPreview } from './OrderSlideOver'
import { RefreshTrainButton, type RefreshTrainState } from '@/components/RefreshTrainButton'
import { UrgencyRail } from '@/components/UrgencyRail'

export type GroupOrder = {
  id: string
  externalOrderId: string
  orderType: string
  contactName: string | null
  contactPhone: string | null
  coach: string | null
  berth: string | null
  rawSeat: string | null
  handoverPoint: string | null
  itemCount: number
  itemNames: string[]
  pax: number | null
  amountPaise: number | null
  paymentMode: string | null
  status: string
  outletName: string | null
  orderTimeLabel: string
  isNew: boolean
}

export type TrainGroup = {
  key: string
  trainNo: string | null
  trainName: string | null
  stationCode: string
  outletNames: string[]
  arrivalLabel: string
  /**
   * The time the orders were booked against, when it differs from the live
   * ETA. Null when they agree, so the card does not print the same time twice.
   */
  bookedLabel: string | null
  delayMinutes: number | null
  platform: string | null
  arrivalIso: string | null
  /** When this train was last checked against the railway, and when it is due again. */
  checkedAtIso: string | null
  nextCheckAtIso: string | null
  /** The provider has confirmed this train left the station. */
  arrived: boolean
  orders: GroupOrder[]
}

/** "9:10 am" in IST, from the ISO strings the server hands this client component. */
function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function lateLabel(mins: number): string {
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m late` : `${mins}m late`
}

function summarise(orders: GroupOrder[]): string {
  const by = (...s: string[]) => orders.filter((o) => s.includes(o.status)).length
  const parts: (string | null)[] = [
    `${orders.length} order${orders.length === 1 ? '' : 's'}`,
    ...(
      [
        [by('RECEIVED'), 'new'],
        [by('ACCEPTED', 'KOT_PRINTED'), 'preparing'],
        [by('PREPARED'), 'ready'],
        [by('DISPATCHED'), 'on the way'],
        [by('DELIVERED'), 'delivered'],
        [by('FAILED', 'CANCELLED', 'LOST'), 'cancelled'],
      ] as const
    ).map(([n, word]) => (n > 0 ? `${n} ${word}` : null)),
  ]
  return parts.filter(Boolean).join(' · ')
}

/**
 * The admin board: one card per train, each opening to its orders.
 *
 * A row opens the order in a panel beside the board rather than a page, so
 * the admin keeps their place in the list.
 */
export function TrainGroups({
  groups,
  serverNow,
  refreshAction,
}: {
  groups: TrainGroup[]
  serverNow: string
  refreshAction: (prev: RefreshTrainState, formData: FormData) => Promise<RefreshTrainState>
}) {
  const ticked = useNowMs(30_000)
  const now = ticked ?? new Date(serverNow).getTime()

  // The first train is the most urgent, so it opens by default.
  const [open, setOpen] = useState<Set<string>>(() => new Set(groups.slice(0, 1).map((g) => g.key)))
  const [selected, setSelected] = useState<OrderPreview | null>(null)

  function toggle(key: string) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const select = (o: GroupOrder) =>
    setSelected({
      id: o.id,
      externalOrderId: o.externalOrderId,
      status: o.status,
      outletName: o.outletName,
    })

  return (
    <>
      <div className="space-y-3">
        {groups.map((g) => {
          const isOpen = open.has(g.key)
          const panelId = `train-${g.key.replace(/[^a-zA-Z0-9_-]/g, '')}`

          return (
            <Card key={g.key} className="overflow-hidden">
              <div className="flex items-stretch">
                <UrgencyRail at={g.arrivalIso} serverNow={serverNow} />

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 pr-2">
                    <button
                      type="button"
                      onClick={() => toggle(g.key)}
                      aria-expanded={isOpen}
                      aria-controls={panelId}
                      className={`flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 text-left transition-colors hover:bg-sunken/50 ${focusRingInset}`}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="font-mono text-base font-bold tabular-nums text-ink">
                            {g.trainNo ?? 'No train no.'}
                          </span>
                          <span className="truncate text-sm font-medium text-muted">{g.trainName}</span>
                          <span className="text-xs text-faint">
                            {g.stationCode}
                            {g.platform ? ` · PF ${g.platform}` : ''}
                          </span>
                        </div>
                        <div className="mt-0.5 text-xs text-muted">
                          {summarise(g.orders)}
                          {g.outletNames.length > 1 ? ` · ${g.outletNames.length} outlets` : ''}
                        </div>
                      </div>

                      <div className="sm:text-right">
                        <div className="flex items-baseline gap-1.5 sm:justify-end">
                          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                            ETA
                          </span>
                          {g.bookedLabel ? (
                            <span
                              className="text-xs tabular-nums text-faint line-through"
                              title="The arrival time these orders were booked against"
                            >
                              {g.bookedLabel}
                            </span>
                          ) : null}
                          <span className="text-base font-bold tabular-nums text-ink">{g.arrivalLabel}</span>
                          {g.delayMinutes !== null && g.delayMinutes > 5 ? (
                            <span className="text-xs font-semibold text-red-600" title="How late the railway reports this train">
                              {lateLabel(g.delayMinutes)}
                            </span>
                          ) : null}
                        </div>
                        {g.checkedAtIso ? (
                          g.arrived ? (
                            <span
                              className="block text-[11px] text-faint"
                              title="This train has left the station, so live tracking has stopped."
                            >
                              arrived · tracking stopped
                            </span>
                          ) : (
                            <span
                              className="block text-[11px] tabular-nums text-faint"
                              title="When this app last asked the railway about this train, and when it will ask again."
                            >
                              checked {hhmm(g.checkedAtIso)} · next{' '}
                              {g.nextCheckAtIso && new Date(g.nextCheckAtIso).getTime() > now
                                ? hhmm(g.nextCheckAtIso)
                                : 'due now'}
                            </span>
                          )
                        ) : null}
                      </div>
                    </button>

                    {/* Outside the toggle on purpose: a submit button cannot
                        nest inside another button, and a click here must not
                        also expand or collapse the row. */}
                    {g.orders[0] ? (
                      <RefreshTrainButton orderId={g.orders[0].id} action={refreshAction} />
                    ) : null}
                    <span
                      aria-hidden
                      className={`flex size-7 items-center justify-center text-muted transition-transform motion-reduce:transition-none ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                    >
                      <IconChevronDown size={18} />
                    </span>
                  </div>

                  {isOpen ? (
                    <div id={panelId} className="overflow-x-auto border-t border-line">
                      <table className="w-full min-w-[46rem] text-sm">
                        <thead className="border-b border-line bg-sunken/60">
                          <tr>
                            <th className={thClass}>Order</th>
                            <th className={thClass}>Passenger</th>
                            <th className={thClass}>Seat</th>
                            <th className={thClass}>Items</th>
                            <th className={`${thClass} text-right`}>Amount</th>
                            <th className={thClass}>Status</th>
                            <th className={`${thClass} whitespace-nowrap`}>Placed</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {g.orders.map((o) => (
                            <tr
                              key={o.id}
                              onClick={() => select(o)}
                              className="cursor-pointer transition-colors hover:bg-sunken/50"
                            >
                              <td className="whitespace-nowrap px-3 py-2.5">
                                <div className="flex items-center gap-1.5">
                                  {/* The real control. The row click is a convenience for the mouse. */}
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); select(o) }}
                                    className={`rounded font-mono text-xs font-semibold text-accent hover:underline ${focusRingInset}`}
                                  >
                                    {o.externalOrderId}
                                  </button>
                                  <TypeBadge type={o.orderType} />
                                  {o.isNew ? (
                                    <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">
                                      New
                                    </span>
                                  ) : null}
                                </div>
                              </td>

                              <td className="px-3 py-2.5">
                                <div className="max-w-[12rem] truncate font-medium text-ink">
                                  {o.contactName ?? <Dash />}
                                </div>
                                {o.contactPhone ? (
                                  <div className="font-mono text-[11px] tabular-nums text-muted">{o.contactPhone}</div>
                                ) : null}
                              </td>

                              <td className="whitespace-nowrap px-3 py-2.5">
                                {o.handoverPoint ? (
                                  <span className="inline-block max-w-[12rem] truncate text-xs font-medium text-fuchsia-700" title={o.handoverPoint}>
                                    Handover: {o.handoverPoint}
                                  </span>
                                ) : (
                                  <CoachChip coach={o.coach} berth={o.berth} rawSeat={o.rawSeat} />
                                )}
                              </td>

                              <td className="max-w-[14rem] px-3 py-2.5">
                                {o.pax ? (
                                  <div className="font-medium text-ink">{o.pax} pax thali</div>
                                ) : o.itemNames.length > 0 ? (
                                  <div className="flex min-w-0 items-center gap-1.5 text-ink" title={o.itemNames.join('\n')}>
                                    <span className="truncate">{o.itemNames[0]}</span>
                                    {o.itemNames.length > 1 ? (
                                      <span className="shrink-0 rounded bg-sunken px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                                        +{o.itemNames.length - 1}
                                      </span>
                                    ) : null}
                                  </div>
                                ) : (
                                  <span className="text-muted">No items</span>
                                )}
                              </td>

                              <td className="whitespace-nowrap px-3 py-2.5 text-right">
                                <div className="font-semibold tabular-nums text-ink">{formatRupees(o.amountPaise)}</div>
                                <PaymentBadge mode={o.paymentMode} />
                              </td>

                              <td className="whitespace-nowrap px-3 py-2.5">
                                <StatusBadge status={o.status} />
                              </td>

                              <td className="whitespace-nowrap px-3 py-2.5 text-xs tabular-nums text-muted">
                                {o.orderTimeLabel}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      <OrderSlideOver preview={selected} onClose={() => setSelected(null)} />
    </>
  )
}
