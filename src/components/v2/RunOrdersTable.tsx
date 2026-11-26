'use client'

import type { MouseEvent, ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatRupees } from '@/lib/format'
import { sourceLabel } from '@/lib/orderEnums'
import type { OrderDiet } from '@/lib/diet'
import { Th, Td } from './Table'
import { Chip, Mono, cx, statusChip, v2Focus } from './ui'
import { KitchenCopyButton, KitchenDietMarks, KitchenNoteHint } from './KitchenBits'
import { DishList } from './DishList'

/** One order as a row under its train, on the kitchen board and in Orders by train. */
export type RunTableRow = {
  id: string
  externalOrderId: string
  source: string | null
  status: string
  contactName: string | null
  phone: string | null
  coach: string | null
  berth: string | null
  rawSeat: string | null
  handoverPoint: string | null
  diet: string | null
  itemNames: string[]
  note: string | null
  amountPaise: number | null
  paymentMode: string | null
  refundPaise?: number | null
  placedLabel: string
  outletName?: string | null
  rider?: string | null
  callNoteCount?: number
  callNoteHint?: string | null
}

/**
 * The train's orders as a table: order, passenger, seat, veg, items, amount,
 * status, placed. Ticks pick orders for the train's button; the last column
 * the status cell also holds a row's own action when the page has one (the kitchen's next step).
 */
export function RunOrdersTable({
  rows,
  trainText,
  selected,
  onToggle,
  onToggleAll,
  showOutlet = false,
  action,
}: {
  rows: RunTableRow[]
  /** The train, for the copied order text. */
  trainText: string
  /** Leave out to show no tick boxes. */
  selected?: Set<string>
  onToggle?: (id: string) => void
  onToggleAll?: (on: boolean) => void
  showOutlet?: boolean
  action?: (row: RunTableRow) => ReactNode
}) {
  const router = useRouter()
  const ticks = Boolean(selected && onToggle)
  const allOn = ticks && rows.length > 0 && rows.every((r) => selected!.has(r.id))
  const someOn = ticks && rows.some((r) => selected!.has(r.id))
  // A click on the row opens the order; clicks on its own controls do not.
  const openRow = (e: MouseEvent<HTMLTableRowElement>, id: string) => {
    if ((e.target as HTMLElement).closest('a,button,input,select,label,form,[role="dialog"]')) return
    router.push(`/v2/orders/${id}`)
  }

  return (
    <>
    {/* Narrower than a laptop (a tablet or phone at the counter): one compact
        row per order, so nothing hides off the side of the screen. */}
    <ul className="divide-y divide-v2-line lg:hidden">
      {rows.map((o) => (
        <CompactRow key={o.id} o={o} ticks={ticks} on={ticks && selected!.has(o.id)} onToggle={() => onToggle?.(o.id)} showOutlet={showOutlet} action={action} />
      ))}
    </ul>
    <div className="hidden min-w-0 overflow-x-auto lg:block">
      {/* Fixed widths, so the columns line up from one train to the next. */}
      <table className="w-full min-w-[900px] table-fixed border-collapse text-[13.5px]">
        <colgroup>
          {ticks ? <col className="w-11" /> : null}
          <col className={cx(ticks ? 'w-[168px]' : 'w-[184px]')} />
          <col className="w-[122px]" />
          <col className="w-[78px]" />
          <col className="w-[46px]" />
          <col />
          <col className="w-[92px]" />
          <col className="w-[118px]" />
          <col className="w-[104px]" />
        </colgroup>
        <thead>
          <tr>
            {ticks ? (
              <Th className="w-12 !rounded-none pl-4">
                <input
                  type="checkbox"
                  aria-label="Tick every order on this train"
                  checked={allOn}
                  ref={(el) => {
                    if (el) el.indeterminate = someOn && !allOn
                  }}
                  onChange={(e) => onToggleAll?.(e.target.checked)}
                  className="size-[18px] cursor-pointer accent-v2-brand"
                />
              </Th>
            ) : null}
            <Th className={cx('!rounded-none', !ticks && 'pl-4')}>Order</Th>
            <Th>Passenger</Th>
            <Th>Seat</Th>
            <Th>Veg</Th>
            <Th>Items</Th>
            <Th align="right">Amount</Th>
            <Th>Status</Th>
            <Th className="!rounded-none pr-4">Placed</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => {
            const on = ticks && selected!.has(o.id)
            const status = statusChip(o.status)
            const cash = o.paymentMode === 'COD'
            return (
              <tr
                key={o.id}
                onClick={(e) => openRow(e, o.id)}
                className={cx('cursor-pointer border-t border-v2-line align-middle transition-colors', on ? 'bg-v2-brand-soft' : 'hover:bg-v2-surface-2')}
              >
                {ticks ? (
                  <Td className="pl-4">
                    <input type="checkbox" aria-label={`Tick ${o.contactName ?? o.externalOrderId}`} checked={on} onChange={() => onToggle!(o.id)} className="size-[18px] cursor-pointer accent-v2-brand" />
                  </Td>
                ) : null}
                <Td className={cx(!ticks && 'pl-4')}>
                  <Link href={`/v2/orders/${o.id}`} className={cx('block truncate font-mono text-[12.5px] font-semibold tracking-[-0.02em] text-v2-brand hover:underline', v2Focus)}>
                    {o.externalOrderId}
                  </Link>
                  <span className="mt-1 flex flex-wrap items-center gap-1">
                    {o.source ? <Chip tone="grey">{sourceLabel(o.source)}</Chip> : null}
                    <KitchenNoteHint count={o.callNoteCount ?? 0} hint={o.callNoteHint ?? null} />
                  </span>
                  {showOutlet && o.outletName ? <span className="mt-0.5 block truncate text-[12px] text-v2-muted" title={o.outletName}>{o.outletName}</span> : null}
                </Td>
                <Td>
                  <span className="block max-w-[11rem] truncate text-[14.5px] font-semibold">{o.contactName ?? 'Passenger'}</span>
                  {o.phone ? <Mono className="block truncate text-[12.5px] text-v2-muted">{o.phone}</Mono> : null}
                </Td>
                <Td>
                  <SeatCell coach={o.coach} berth={o.berth} rawSeat={o.rawSeat} handoverPoint={o.handoverPoint} />
                </Td>
                <Td>
                  <KitchenDietMarks diet={(o.diet ?? null) as OrderDiet} />
                </Td>
                <Td className="whitespace-normal">
                  <span className="block text-[14.5px] leading-snug">
                    <DishList items={o.itemNames} note={o.note} max={4} />
                  </span>
                  {o.note ? <span className="mt-1 block rounded-v2-sm bg-v2-info-bg px-2 py-0.5 text-[12.5px] font-semibold text-v2-info">Note: {o.note}</span> : null}
                </Td>
                <Td align="right">
                  <Mono className="block text-[15px] font-bold">{o.amountPaise == null ? '—' : formatRupees(o.amountPaise)}</Mono>
                  <span className="mt-1 inline-block">
                    {cash ? <Chip tone="warn">{o.amountPaise == null ? 'Cash, no amount' : 'Cash'}</Chip> : <Chip tone="grey">Prepaid</Chip>}
                  </span>
                  {o.refundPaise ? <span className="mt-0.5 block text-[12px] font-semibold text-v2-bad">Refunded {formatRupees(o.refundPaise)}</span> : null}
                </Td>
                <Td>
                  <Chip tone={status.tone}>{status.label}</Chip>
                  {o.rider ? <span className="mt-1 block truncate text-[12px] text-v2-muted">with {o.rider}</span> : null}
                  {/* This order's own next step, under where it is now. */}
                  {/* Stacked to the column's width: "choose a rider" and its button
                      would otherwise run into the next column. */}
                  {action ? (
                    <span className="mt-1.5 flex min-w-0 empty:hidden [&>form]:w-full [&>form]:flex-col [&>form]:items-stretch [&>form]:gap-1.5 [&>form>*]:w-full [&_button]:max-w-full [&_svg]:shrink-0">
                      {action(o)}
                    </span>
                  ) : null}
                </Td>
                <Td className="pr-4">
                  <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
                    <Mono className="text-[13px] text-v2-ink-2">{o.placedLabel}</Mono>
                    <KitchenCopyButton text={orderText(o, trainText)} label="Copy order details" />
                  </span>
                </Td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
    </>
  )
}

function CompactRow({ o, ticks, on, onToggle, showOutlet, action }: { o: RunTableRow; ticks: boolean; on: boolean; onToggle: () => void; showOutlet: boolean; action?: (row: RunTableRow) => ReactNode }) {
  const status = statusChip(o.status)
  const cash = o.paymentMode === 'COD'
  return (
    <li className={cx('grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 px-4 py-3', on ? 'bg-v2-brand-soft' : '')}>
      <span className="flex items-center gap-3 pt-0.5">
        {ticks ? <input type="checkbox" aria-label={`Tick ${o.contactName ?? o.externalOrderId}`} checked={on} onChange={onToggle} className="size-5 cursor-pointer accent-v2-brand" /> : null}
        <SeatCell coach={o.coach} berth={o.berth} rawSeat={o.rawSeat} handoverPoint={o.handoverPoint} />
      </span>
      <Link href={`/v2/orders/${o.id}`} className={cx('min-w-0 rounded-v2-sm', v2Focus)}>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[15px] font-semibold">{o.contactName ?? 'Passenger'}</span>
          <span className="font-mono text-[12px] text-v2-brand">{o.externalOrderId}</span>
          <Chip tone={status.tone}>{status.label}</Chip>
          {o.source ? <Chip tone="grey">{sourceLabel(o.source)}</Chip> : null}
        </span>
        <span className="mt-1 flex items-start gap-1.5 text-[14.5px] leading-snug">
          <KitchenDietMarks diet={(o.diet ?? null) as OrderDiet} className="mt-1" />
          <span className="min-w-0">
            <DishList items={o.itemNames} note={o.note} max={3} />
          </span>
        </span>
        {o.note ? <span className="mt-1 block rounded-v2-sm bg-v2-info-bg px-2 py-0.5 text-[12.5px] font-semibold text-v2-info">Note: {o.note}</span> : null}
        <span className="mt-1 block text-[12px] text-v2-muted">
          {[o.phone, `placed ${o.placedLabel}`, o.rider ? `with ${o.rider}` : null, showOutlet ? o.outletName : null].filter(Boolean).join(' · ')}
        </span>
      </Link>
      <span className="grid justify-items-end gap-1.5 text-right">
        <Mono className="text-[15px] font-bold">{o.amountPaise == null ? '—' : formatRupees(o.amountPaise)}</Mono>
        {cash ? <Chip tone="warn">Cash</Chip> : <Chip tone="grey">Prepaid</Chip>}
        {action ? <span className="flex empty:hidden">{action(o)}</span> : null}
      </span>
    </li>
  )
}

/** "B3 45": the coach as a dark tag and the berth beside it, big enough to read across a counter. */
function SeatCell({ coach, berth, rawSeat, handoverPoint }: { coach: string | null; berth: string | null; rawSeat: string | null; handoverPoint: string | null }) {
  if (handoverPoint) {
    return (
      <span className="block max-w-[9rem] truncate text-[12.5px] font-semibold" title={handoverPoint}>
        {handoverPoint}
      </span>
    )
  }
  if (coach) {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <span className="rounded-md bg-v2-ink px-1.5 py-0.5 font-mono text-[14px] font-bold text-v2-bg">{coach}</span>
        {berth ? <span className="font-mono text-[16px] font-bold tabular-nums">{berth}</span> : null}
      </span>
    )
  }
  return rawSeat ? <Mono className="text-[13px]">{rawSeat}</Mono> : <span className="text-v2-faint">—</span>
}

/** The order as plain text, to paste into a chat. */
function orderText(o: RunTableRow, trainText: string): string {
  const seat = o.handoverPoint ?? (o.coach ? `${o.coach} ${o.berth ?? ''}`.trim() : o.rawSeat ?? '')
  return [
    `${o.externalOrderId}${o.source ? ` (${sourceLabel(o.source)})` : ''}`,
    trainText,
    [o.contactName, o.phone].filter(Boolean).join(' · '),
    seat ? `Seat ${seat}` : null,
    o.itemNames.join(', '),
    o.amountPaise != null ? `${formatRupees(o.amountPaise)} ${o.paymentMode === 'COD' ? 'cash' : 'prepaid'}` : null,
    o.note ? `Note: ${o.note}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}
