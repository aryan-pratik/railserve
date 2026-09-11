'use client'

import { useActionState, useEffect, useState } from 'react'
import Link from 'next/link'
import { formatRupees, formatServiceDate, formatShortDate, formatTimeIST, paiseToRupees } from '@/lib/format'
import { CoachChip, Dash, EmptyState, IconButton, StatusBadge, TypeBadge, statusLabel, thClass, focusRingInset } from '@/components/ui'
import { IconCheck, IconClose, IconPencil } from '@/components/Icons'
import { OrderTableColGroup, TableFrame } from '@/components/OrdersTable'
import { updateOrderAmountAction, updateOrderStatusAction, type ActionState } from './actions'

type Maybe<T> = T | null | undefined

export type AdminOrderRow = {
  id: string
  externalOrderId: string
  orderType: string
  status: string
  serviceDate: string
  trainNo?: Maybe<string>
  coach?: Maybe<string>
  berth?: Maybe<string>
  rawSeat?: Maybe<string>
  contactName?: Maybe<string>
  scheduledArrival?: Maybe<string>
  amountPaise?: Maybe<number>
  outletName?: Maybe<string>
  remark?: Maybe<string>
}

const EDIT_TRIGGER =
  `group/edit inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-sunken ${focusRingInset}`
const EDIT_INPUT =
  'h-7 rounded border border-line-strong bg-surface px-1.5 text-xs text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent'
const INITIAL_STATE: ActionState = {}

/**
 * Admin-only variant of OrdersTable with Amount and Status editable in place.
 * Kept separate from the shared OrdersTable (used by store history and the
 * store board's flat view) so those never gain an edit affordance.
 */
export function AdminOrdersTable({
  orders,
  showOutlet = false,
  statusOptions,
  emptyNote = 'Nothing matches these filters.',
}: {
  orders: AdminOrderRow[]
  showOutlet?: boolean
  statusOptions: string[]
  emptyNote?: string
}) {
  if (orders.length === 0) {
    return <EmptyState title="No orders" note={emptyNote} />
  }

  return (
    <TableFrame>
      <table className="w-full min-w-[56rem] table-fixed text-sm">
        <OrderTableColGroup showOutlet={showOutlet} />
        <thead className="border-b border-line bg-sunken/60">
          <tr>
            <th className={thClass}>Order</th>
            <th className={thClass}>Date</th>
            <th className={thClass}>Train</th>
            <th className={thClass}>Seat</th>
            <th className={thClass}>Passenger</th>
            {showOutlet ? <th className={thClass}>Outlet</th> : null}
            <th className={thClass}>Remark</th>
            <th className={`${thClass} text-right`}>Amount</th>
            <th className={thClass}>Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {orders.map((o) => (
            <AdminOrderRow key={o.id} order={o} showOutlet={showOutlet} statusOptions={statusOptions} />
          ))}
        </tbody>
      </table>
    </TableFrame>
  )
}

/** A pencil that stays out of the way until the row is under the cursor or keyboard. */
function Pencil() {
  return (
    <IconPencil
      size={12}
      aria-hidden
      className="shrink-0 text-faint opacity-0 transition-opacity group-hover/edit:opacity-100 group-focus-visible/edit:opacity-100"
    />
  )
}

function AdminOrderRow({
  order,
  showOutlet,
  statusOptions,
}: {
  order: AdminOrderRow
  showOutlet: boolean
  statusOptions: string[]
}) {
  const [editing, setEditing] = useState<'amount' | 'status' | null>(null)

  return (
    <tr className="transition-colors hover:bg-sunken/60">
      <td className="px-3 py-2.5">
        <Link href={`/admin/orders/${order.id}`} className="flex min-w-0 items-center gap-1.5 font-medium text-accent hover:underline">
          <span className="truncate font-mono text-xs">{order.externalOrderId}</span>
          <TypeBadge type={order.orderType} />
        </Link>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-muted" title={formatServiceDate(order.serviceDate)}>
        {formatShortDate(order.serviceDate)}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5">
        <span className="font-mono tabular-nums text-ink">{order.trainNo ?? <Dash />}</span>
        {order.scheduledArrival ? (
          <span className="ml-1.5 text-xs tabular-nums text-muted">{formatTimeIST(order.scheduledArrival)}</span>
        ) : null}
      </td>
      <td className="px-3 py-2.5">
        <CoachChip coach={order.coach} berth={order.berth} rawSeat={order.rawSeat} />
      </td>
      <td className="truncate px-3 py-2.5 text-ink" title={order.contactName ?? undefined}>{order.contactName ?? <Dash />}</td>
      {showOutlet ? <td className="truncate px-3 py-2.5 text-muted" title={order.outletName ?? undefined}>{order.outletName ?? <Dash />}</td> : null}
      <td className="truncate px-3 py-2.5 text-amber-800" title={order.remark ?? undefined}>
        {order.remark ?? <Dash />}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-ink">
        {editing === 'amount' ? (
          <AmountEditor orderId={order.id} initial={order.amountPaise} onDone={() => setEditing(null)} />
        ) : (
          <button type="button" onClick={() => setEditing('amount')} className={`${EDIT_TRIGGER} ml-auto`} title="Edit amount">
            {formatRupees(order.amountPaise)}
            <Pencil />
          </button>
        )}
      </td>
      <td className="px-3 py-2.5">
        {editing === 'status' ? (
          <StatusEditor orderId={order.id} current={order.status} options={statusOptions} onDone={() => setEditing(null)} />
        ) : (
          <button type="button" onClick={() => setEditing('status')} className={EDIT_TRIGGER} title="Edit status">
            <StatusBadge status={order.status} />
            <Pencil />
          </button>
        )}
      </td>
    </tr>
  )
}

function EditorButtons({ pending, onCancel, disabled }: { pending: boolean; onCancel: () => void; disabled?: boolean }) {
  return (
    <>
      <IconButton type="submit" aria-label="Save" size="sm" disabled={pending || disabled} className="text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800">
        <IconCheck size={14} />
      </IconButton>
      <IconButton aria-label="Cancel" size="sm" onClick={onCancel}>
        <IconClose size={14} />
      </IconButton>
    </>
  )
}

function AmountEditor({
  orderId,
  initial,
  onDone,
}: {
  orderId: string
  initial: number | null | undefined
  onDone: () => void
}) {
  const [state, formAction, pending] = useActionState(updateOrderAmountAction, INITIAL_STATE)

  useEffect(() => {
    if (state.ok) onDone()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok])

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="orderId" value={orderId} />
      <div className="flex items-center gap-1">
        <input
          name="amountRupees"
          defaultValue={paiseToRupees(initial)}
          inputMode="decimal"
          autoFocus
          className={`${EDIT_INPUT} w-20 text-right`}
          aria-label="Amount in rupees"
          onKeyDown={(e) => { if (e.key === 'Escape') onDone() }}
        />
        <EditorButtons pending={pending} onCancel={onDone} />
      </div>
      {state.error ? <span role="alert" className="text-[11px] font-medium text-red-600">{state.error}</span> : null}
    </form>
  )
}

const ADD_NEW = '__add_new__'

function StatusEditor({
  orderId,
  current,
  options,
  onDone,
}: {
  orderId: string
  current: string
  options: string[]
  onDone: () => void
}) {
  const [state, formAction, pending] = useActionState(updateOrderStatusAction, INITIAL_STATE)
  const [choice, setChoice] = useState(current)
  const [custom, setCustom] = useState('')
  const isCustom = choice === ADD_NEW

  useEffect(() => {
    if (state.ok) onDone()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok])

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="to" value={isCustom ? custom : choice} />
      <div className="flex items-center gap-1">
        <select
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          className={EDIT_INPUT}
          aria-label="Status"
          autoFocus
          onKeyDown={(e) => { if (e.key === 'Escape') onDone() }}
        >
          {options.map((s) => (
            <option key={s} value={s}>{statusLabel(s)}</option>
          ))}
          <option value={ADD_NEW}>Add a new status…</option>
        </select>
        <EditorButtons pending={pending} onCancel={onDone} disabled={isCustom && !custom.trim()} />
      </div>
      {isCustom ? (
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="e.g. Refund pending"
          autoFocus
          className={EDIT_INPUT}
          aria-label="New status name"
        />
      ) : null}
      {state.error ? <span role="alert" className="text-[11px] font-medium text-red-600">{state.error}</span> : null}
    </form>
  )
}
