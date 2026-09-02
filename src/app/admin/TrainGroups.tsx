'use client'

import { useState } from 'react'
import { useNowMs } from '@/components/useNow'
import { formatRupees } from '@/lib/format'
import { statusLabel } from '@/components/ui'
import { IconTrain, IconChevronDown } from '@/components/Icons'
import { OrderSlideOver } from './OrderSlideOver'

export type GroupOrder = {
  id: string
  externalOrderId: string
  orderType: string
  contactName: string | null
  contactPhone: string | null
  coach: string | null
  berth: string | null
  handoverPoint: string | null
  itemCount: number
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
  orders: GroupOrder[]
}

/** Status pill colors with soft background and clear text */
const STATUS_PILL: Record<string, { bg: string; text: string; ring: string; dot: string }> = {
  RECEIVED: { bg: 'bg-blue-50', text: 'text-blue-700', ring: 'ring-blue-200', dot: 'bg-blue-600' },
  ACCEPTED: { bg: 'bg-indigo-50', text: 'text-indigo-700', ring: 'ring-indigo-200', dot: 'bg-indigo-600' },
  KOT_PRINTED: { bg: 'bg-violet-50', text: 'text-violet-700', ring: 'ring-violet-200', dot: 'bg-violet-600' },
  PREPARED: { bg: 'bg-amber-50', text: 'text-amber-800', ring: 'ring-amber-200', dot: 'bg-amber-600' },
  DISPATCHED: { bg: 'bg-orange-50', text: 'text-orange-800', ring: 'ring-orange-200', dot: 'bg-orange-600' },
  DELIVERED: { bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-200', dot: 'bg-emerald-600' },
  FAILED: { bg: 'bg-red-50', text: 'text-red-700', ring: 'ring-red-200', dot: 'bg-red-600' },
  CANCELLED: { bg: 'bg-slate-100', text: 'text-slate-600', ring: 'ring-slate-200', dot: 'bg-slate-500' },
  LOST: { bg: 'bg-slate-100', text: 'text-slate-600', ring: 'ring-slate-200', dot: 'bg-slate-500' },
}

const TH = 'px-4 py-3 text-left text-xs font-semibold text-muted tracking-wide uppercase'

export function TrainGroups({
  groups,
  serverNow,
}: {
  groups: TrainGroup[]
  serverNow: string
}) {
  const ticked = useNowMs(30_000)
  const now = ticked ?? new Date(serverNow).getTime()

  // Default: Open the first group
  const [open, setOpen] = useState<Set<string>>(() => new Set(groups.slice(0, 1).map((g) => g.key)))
  const [selected, setSelected] = useState<string | null>(null)

  function toggle(key: string) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <>
      <div className="space-y-3">
        {groups.map((g) => {
          const isOpen = open.has(g.key)
          const minutesAway = g.arrivalIso
            ? Math.round((new Date(g.arrivalIso).getTime() - now) / 60_000)
            : null

          return (
            <div
              key={g.key}
              className={`overflow-hidden rounded-2xl border bg-surface shadow-2xs transition-all duration-200 ${
                isOpen ? 'border-accent/40 shadow-xs' : 'border-line hover:border-line-strong'
              }`}
            >
              <div className="flex items-stretch">
                {/* Left urgency accent bar */}
                <span className={`w-1.5 shrink-0 ${accent(minutesAway)}`} aria-hidden />

                <button
                  type="button"
                  onClick={() => toggle(g.key)}
                  aria-expanded={isOpen}
                  className="flex flex-1 items-center justify-between gap-4 p-4 text-left transition hover:bg-sunken/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                      <IconTrain size={22} />
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                        <span className="font-mono text-base font-bold tabular-nums text-ink">
                          {g.trainNo ?? 'No train no.'}
                        </span>
                        <span className="truncate text-sm font-semibold text-ink">
                          {g.trainName}
                        </span>
                        <span className="text-xs font-medium text-muted">
                          {g.stationCode}
                          {g.platform ? ` (PF ${g.platform})` : ''}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        <span>{summarise(g.orders)}</span>
                        {g.outletNames.length > 1 ? (
                          <span>· {g.outletNames.length} outlets</span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right">
                      <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted">
                        ETA at next stop
                      </span>
                      <span className="flex items-baseline justify-end gap-1.5">
                        {/* What the orders were booked against, when the live
                            ETA has moved off it. Without this the card shows a
                            time with nothing to compare it to, and a two-hour
                            change looks the same as no change at all. */}
                        {g.bookedLabel ? (
                          <span
                            className="text-xs tabular-nums text-faint line-through decoration-faint/60"
                            title="The arrival time these orders were booked against"
                          >
                            {g.bookedLabel}
                          </span>
                        ) : null}
                        <span className="text-sm font-bold tabular-nums text-accent">
                          {g.arrivalLabel}
                        </span>
                      </span>
                      {g.delayMinutes !== null && g.delayMinutes > 5 ? (
                        <span
                          className="block text-[11px] font-semibold text-red-600"
                          title="How late the railway reports this train, against its own timetable"
                        >
                          {lateLabel(g.delayMinutes)}
                        </span>
                      ) : null}
                    </div>

                    <div
                      className={`flex size-7 items-center justify-center rounded-lg text-muted transition-transform duration-200 ${
                        isOpen ? 'rotate-180 bg-sunken text-ink' : ''
                      }`}
                      aria-hidden
                    >
                      <IconChevronDown size={18} />
                    </div>
                  </div>
                </button>
              </div>

              {isOpen ? (
                <div className="overflow-x-auto border-t border-line">
                  <table className="w-full text-xs sm:text-sm">
                    <thead className="border-b border-line bg-sunken/40">
                      <tr>
                        <th className={TH}>Order ID</th>
                        <th className={TH}>Customer</th>
                        <th className={TH}>Coach / Seat</th>
                        <th className={TH}>Items</th>
                        <th className={TH}>Amount</th>
                        <th className={TH}>Status</th>
                        <th className={`${TH} whitespace-nowrap`}>Order Time</th>
                        <th className={`${TH} text-right`}>
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {g.orders.map((o) => {
                        const pill = STATUS_PILL[o.status] ?? {
                          bg: 'bg-slate-100',
                          text: 'text-slate-600',
                          ring: 'ring-slate-200',
                          dot: 'bg-slate-500',
                        }

                        return (
                          <tr
                            key={o.id}
                            onClick={() => setSelected(o.id)}
                            tabIndex={0}
                            role="button"
                            aria-label={`Open order ${o.externalOrderId}`}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                setSelected(o.id)
                              }
                            }}
                            className="group cursor-pointer transition hover:bg-sunken/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                          >
                            {/* Order ID */}
                            <td className="whitespace-nowrap px-4 py-3.5">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-xs font-semibold text-ink">
                                  {o.externalOrderId}
                                </span>
                                {o.orderType === 'BULK' ? (
                                  <span className="rounded bg-fuchsia-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-fuchsia-800 ring-1 ring-inset ring-fuchsia-200">
                                    BULK
                                  </span>
                                ) : null}
                                {o.isNew ? (
                                  <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent ring-1 ring-accent/20">
                                    NEW
                                  </span>
                                ) : null}
                              </div>
                            </td>

                            {/* Customer */}
                            <td className="px-4 py-3.5">
                              <div className="font-medium text-ink">
                                {o.contactName ?? '—'}
                              </div>
                              {o.contactPhone ? (
                                <div className="font-mono text-[11px] text-muted">
                                  PNR: {o.contactPhone.replace(/\d{4}$/, 'XXXX')}
                                </div>
                              ) : null}
                            </td>

                            {/* Coach / Seat */}
                            <td className="whitespace-nowrap px-4 py-3.5">
                              {o.handoverPoint ? (
                                <span
                                  className="inline-block max-w-[200px] truncate rounded-lg bg-fuchsia-50 px-2 py-1 text-xs font-semibold text-fuchsia-700 ring-1 ring-fuchsia-200"
                                  title={o.handoverPoint}
                                >
                                  Handover: {o.handoverPoint}
                                </span>
                              ) : o.coach ? (
                                <span className="rounded-lg bg-accent-soft px-2.5 py-1 font-mono text-xs font-bold text-accent ring-1 ring-accent/20">
                                  {o.coach}{o.berth ? ` / ${o.berth}` : ''}
                                </span>
                              ) : (
                                <span className="text-muted">—</span>
                              )}
                            </td>

                            {/* Items */}
                            <td className="whitespace-nowrap px-4 py-3.5">
                              <div className="font-medium text-ink">
                                {o.pax ? `${o.pax} pax thali` : `${o.itemCount} item${o.itemCount === 1 ? '' : 's'}`}
                              </div>
                              {o.pax && o.itemCount > 1 ? (
                                <div className="text-[11px] text-muted">+{o.itemCount - 1} packing items</div>
                              ) : o.pax ? (
                                <div className="text-[11px] text-muted">{o.pax} pax</div>
                              ) : null}
                            </td>

                            {/* Amount */}
                            <td className="whitespace-nowrap px-4 py-3.5">
                              <div className="font-bold tabular-nums text-ink">
                                {formatRupees(o.amountPaise)}
                              </div>
                              {o.paymentMode ? (
                                <span
                                  className={`mt-0.5 inline-block rounded-md px-1.5 py-0.2 text-[10px] font-bold uppercase tracking-wider ${
                                    o.paymentMode === 'COD'
                                      ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-200'
                                      : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                                  }`}
                                >
                                  {o.paymentMode === 'COD' ? 'COD' : 'Prepaid'}
                                </span>
                              ) : null}
                            </td>

                            {/* Status */}
                            <td className="whitespace-nowrap px-4 py-3.5">
                              <span
                                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${pill.bg} ${pill.text} ${pill.ring}`}
                              >
                                <span className={`size-1.5 rounded-full ${pill.dot}`} aria-hidden />
                                <span>{statusLabel(o.status)}</span>
                              </span>
                            </td>

                            {/* Order Time */}
                            <td className="whitespace-nowrap px-4 py-3.5 tabular-nums text-muted text-xs">
                              {o.orderTimeLabel}
                            </td>

                            {/* Actions */}
                            <td className="whitespace-nowrap px-4 py-3.5 text-right">
                              <button
                                type="button"
                                title="Open details"
                                className="flex size-7 items-center justify-center rounded-lg text-faint group-hover:text-ink hover:bg-sunken ml-auto transition-colors"
                              >
                                ⋮
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      <OrderSlideOver orderId={selected} onClose={() => setSelected(null)} />
    </>
  )
}

function summarise(orders: GroupOrder[]): string {
  const by = (...s: string[]) => orders.filter((o) => s.includes(o.status)).length
  const parts = [
    `${orders.length} order${orders.length === 1 ? '' : 's'}`,
    [by('RECEIVED'), 'new'] as const,
    [by('ACCEPTED', 'KOT_PRINTED'), 'preparing'] as const,
    [by('PREPARED'), 'ready'] as const,
    [by('DISPATCHED'), 'on the way'] as const,
    [by('DELIVERED'), 'delivered'] as const,
    [by('FAILED', 'CANCELLED', 'LOST'), 'cancelled'] as const,
  ]
  return parts
    .map((p) => (typeof p === 'string' ? p : p[0] > 0 ? `${p[0]} ${p[1]}` : null))
    .filter(Boolean)
    .join(' • ')
}

function lateLabel(mins: number): string {
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m late` : `${mins}m late`
}

function accent(minutesAway: number | null): string {
  if (minutesAway === null || minutesAway < -90) return 'bg-line'
  if (minutesAway <= 20) return 'bg-red-600'
  if (minutesAway <= 45) return 'bg-amber-500'
  return 'bg-accent'
}
