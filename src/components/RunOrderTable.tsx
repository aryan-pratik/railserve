'use client'

import Link from 'next/link'
import { formatRupees } from '@/lib/format'
import { CoachChip, Dash, PaymentBadge, StatusBadge, TypeBadge, focusRingInset, thClass } from './ui'
import { CallNoteHint } from './CallNoteHint'
import { CopyButton } from './CopyButton'

/** One order as a run's table lists it. */
export type RunTableOrder = {
  id: string
  /**
   * Where this row goes when it is clicked. The kitchen board sets it (the
   * order page is where Accept, Print KOT and Mark ready live); the admin
   * board leaves it unset and passes `onSelect` instead, to open its panel.
   */
  href?: string | null
  externalOrderId: string
  orderType: string
  contactName: string | null
  contactPhone: string | null
  coach: string | null
  berth: string | null
  rawSeat: string | null
  handoverPoint: string | null
  pax: number | null
  /** What is being cooked, one label each — see foodItemLabels. */
  itemNames: string[]
  amountPaise: number | null
  paymentMode: string | null
  status: string
  /** Which kitchen the order is on. Rendered only when `showOutlet` says so. */
  outletName?: string | null
  orderTimeLabel: string
  /** Nobody has accepted it yet. */
  isNew: boolean
  /** Call-note count and prebuilt tooltip text. See callNoteSummary. */
  callNoteCount?: number | null
  callNoteHint?: string | null
}

/** Everything shown in a row, as plain text for pasting elsewhere. */
function orderDetailsText(o: RunTableOrder, trainText?: string): string {
  const seat = o.handoverPoint
    ? `Handover: ${o.handoverPoint}`
    : [o.coach, o.berth, o.rawSeat].filter(Boolean).join(' ') || '-'
  const items = o.pax ? `${o.pax} pax thali` : o.itemNames.join(', ') || 'No items'
  const lines = [
    `Order ${o.externalOrderId} (${o.orderType})`,
    `Passenger: ${o.contactName ?? '-'}${o.contactPhone ? ` (${o.contactPhone})` : ''}`,
    `Seat: ${seat}`,
    `Items: ${items}`,
    `Amount: ${formatRupees(o.amountPaise)}${o.paymentMode ? ` (${o.paymentMode})` : ''}`,
    `Status: ${o.status}`,
    `Placed: ${o.orderTimeLabel}`,
    trainText ? `Train: ${trainText}` : null,
  ]
  return lines.filter((l): l is string => l !== null).join('\n')
}

/**
 * Every order on one train, as a table.
 *
 * Shared between the admin board and the kitchen board so the two cannot
 * drift apart on what an order says. What differs is only how a row is
 * opened: admin hands in `onSelect` and gets its side panel, the kitchen
 * board puts an `href` on each row and gets the order page.
 *
 * The kitchen board is a server component, and a function prop cannot cross
 * that boundary — which is why the destination is a string on the row rather
 * than a callback.
 */
export function RunOrderTable({
  orders,
  onSelect,
  showOutlet = false,
  trainText,
}: {
  orders: RunTableOrder[]
  /** Only from a client parent. Rows without it navigate by `href`. */
  onSelect?: (o: RunTableOrder) => void
  /**
   * Name each order's kitchen under its id. Off by default: on a board where
   * every order is from the same kitchen it is the same word on every row.
   */
  showOutlet?: boolean
  /**
   * The train's details as plain text, appended to "Copy order details" so a
   * pasted order says which train it is on. Off by default.
   */
  trainText?: string
}) {
  return (
    // The min-width gives the scroll wrapper something coherent to scroll:
    // seven columns do not fit a phone, and a squeezed table is worse than
    // one that slides.
    <div className="overflow-x-auto border-t border-line">
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
          {orders.map((o) => (
            <tr
              key={o.id}
              // The row click is a convenience for the mouse where a panel
              // opens in place. Where the row leads to a page it is left to
              // the link in the first cell instead: a click handler on the
              // row would swallow ⌘-click and middle-click, and opening an
              // order in a new tab is how a manager keeps their place on a
              // board they are working down.
              onClick={onSelect ? () => onSelect(o) : undefined}
              className={`group transition-colors hover:bg-sunken/50 ${onSelect ? 'cursor-pointer' : ''}`}
            >
              <td className="whitespace-nowrap px-3 py-2.5">
                <div className="flex items-center gap-1.5">
                  {/* The real control. */}
                  {o.href ? (
                    <Link
                      href={o.href}
                      className={`rounded font-mono text-xs font-semibold text-accent hover:underline ${focusRingInset}`}
                    >
                      {o.externalOrderId}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onSelect?.(o) }}
                      className={`rounded font-mono text-xs font-semibold text-accent hover:underline ${focusRingInset}`}
                    >
                      {o.externalOrderId}
                    </button>
                  )}
                  <CallNoteHint orderId={o.id} count={o.callNoteCount} hint={o.callNoteHint} />
                  <TypeBadge type={o.orderType} />
                  {o.isNew ? (
                    <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">
                      New
                    </span>
                  ) : null}
                </div>
                {/* Which kitchen this one is on. Under the id rather than in
                    a column of its own: it is the same answer for most of a
                    board, and the columns that vary earn the width. */}
                {showOutlet && o.outletName ? (
                  <div className="mt-0.5 max-w-[12rem] truncate text-[11px] text-muted" title={o.outletName}>
                    {o.outletName}
                  </div>
                ) : null}
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

              {/* Only the first dish fits; the rest sit behind the count and
                  the tooltip. A pax thali is one item whose "name" is the
                  whole composite menu (see OrderItemSchema.spec), so it
                  stays a head count. */}
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
                {/* A COD order with no amount is the dangerous case — the
                    rider has nothing to collect against — so it says so
                    instead of printing a dash and a quiet badge. */}
                {o.paymentMode === 'COD' && o.amountPaise == null ? (
                  <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-bold text-red-800 ring-1 ring-inset ring-red-200">
                    COD · amount missing
                  </span>
                ) : (
                  <>
                    <div className="font-semibold tabular-nums text-ink">{formatRupees(o.amountPaise)}</div>
                    <PaymentBadge mode={o.paymentMode} />
                  </>
                )}
              </td>

              <td className="whitespace-nowrap px-3 py-2.5">
                <StatusBadge status={o.status} />
              </td>

              <td className="whitespace-nowrap px-3 py-2.5 text-xs tabular-nums text-muted">
                <div className="flex items-center gap-1">
                  {o.orderTimeLabel}
                  <span className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
                    <CopyButton text={orderDetailsText(o, trainText)} label="Copy order details" />
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
