'use client'

import { useActionState, useEffect, useState } from 'react'
import Link from 'next/link'
import { formatRupees, formatTimeIST, formatServiceDate, paiseToRupees } from '@/lib/format'
import { CoachChip, EmptyState, StatusBadge, TypeBadge, statusLabel } from '@/components/ui'
import { OrderTableColGroup } from '@/components/OrdersTable'
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
  contactName?: Maybe<string>
  scheduledArrival?: Maybe<string>
  amountPaise?: Maybe<number>
  outletName?: Maybe<string>
  remark?: Maybe<string>
}

const TH = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted'
const EDIT_BUTTON =
  'rounded transition hover:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'
const EDIT_INPUT =
  'rounded border border-line-strong bg-surface px-1.5 py-1 text-xs text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent'
const INITIAL_STATE: ActionState = {}

/**
 * Admin-only variant of OrdersTable with Amount and Status directly editable
 * inline. Kept separate from the shared OrdersTable (also used by
 * store/history and the store board's flat view) so those pages never gain
 * an edit affordance they were not asked for.
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
    <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
      <table className="w-full table-fixed text-sm">
        <OrderTableColGroup showOutlet={showOutlet} />
        <thead className="border-b border-line bg-sunken/60">
          <tr>
            <th className={TH}>Order</th>
            <th className={TH}>Date</th>
            <th className={TH}>Train</th>
            <th className={TH}>Seat</th>
            <th className={TH}>Passenger</th>
            {showOutlet ? <th className={TH}>Outlet</th> : null}
            <th className={TH}>Remark</th>
            <th className={`${TH} text-right`}>Amount</th>
            <th className={TH}>Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {orders.map((o) => (
            <AdminOrderRow
              key={o.id}
              order={o}
              showOutlet={showOutlet}
              statusOptions={statusOptions}
            />
          ))}
        </tbody>
      </table>
    </div>
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
    <tr className="transition hover:bg-sunken/60">
      <td className="px-3 py-2.5">
        <Link
          href={`/admin/orders/${order.id}`}
          className="flex min-w-0 items-center gap-1.5 font-medium text-accent hover:underline"
        >
          <span className="truncate font-mono text-xs">{order.externalOrderId}</span>
          <TypeBadge type={order.orderType} />
        </Link>
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap text-muted">
        {formatServiceDate(order.serviceDate)}
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        <span className="font-mono tabular-nums text-ink">{order.trainNo ?? '—'}</span>
        {order.scheduledArrival ? (
          <span className="ml-1.5 tabular-nums text-xs text-muted">
            {formatTimeIST(order.scheduledArrival)}
          </span>
        ) : null}
      </td>
      <td className="px-3 py-2.5">
        <CoachChip coach={order.coach} berth={order.berth} />
      </td>
      <td className="px-3 py-2.5 text-ink">{order.contactName ?? '—'}</td>
      {showOutlet ? <td className="px-3 py-2.5 text-muted">{order.outletName ?? '—'}</td> : null}
      <td
        className="truncate px-3 py-2.5 text-amber-800"
        title={order.remark ?? undefined}
      >
        {order.remark ?? '—'}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-ink">
        {editing === 'amount' ? (
          <AmountEditor
            orderId={order.id}
            initial={order.amountPaise}
            onDone={() => setEditing(null)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing('amount')}
            className={`${EDIT_BUTTON} inline-flex items-center gap-1 px-1.5 py-0.5`}
            title="Edit amount"
          >
            {formatRupees(order.amountPaise)}
            <span className="text-faint" aria-hidden>✎</span>
          </button>
        )}
      </td>
      <td className="px-3 py-2.5">
        {editing === 'status' ? (
          <StatusEditor
            orderId={order.id}
            current={order.status}
            options={statusOptions}
            onDone={() => setEditing(null)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing('status')}
            className={`${EDIT_BUTTON} inline-flex items-center gap-1 p-0.5`}
            title="Edit status"
          >
            <StatusBadge status={order.status} />
            <span className="text-faint" aria-hidden>✎</span>
          </button>
        )}
      </td>
    </tr>
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
        />
        <button type="submit" disabled={pending} className={`${EDIT_BUTTON} px-1.5 py-1 text-emerald-700`}>
          ✓
        </button>
        <button type="button" onClick={onDone} className={`${EDIT_BUTTON} px-1.5 py-1 text-muted`}>
          ✕
        </button>
      </div>
      {state.error ? <span className="text-[10px] font-medium text-red-600">{state.error}</span> : null}
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
        >
          {options.map((s) => (
            <option key={s} value={s}>{statusLabel(s)}</option>
          ))}
          <option value={ADD_NEW}>Add new status…</option>
        </select>
        <button
          type="submit"
          disabled={pending || (isCustom && !custom.trim())}
          className={`${EDIT_BUTTON} px-1.5 py-1 text-emerald-700`}
        >
          ✓
        </button>
        <button type="button" onClick={onDone} className={`${EDIT_BUTTON} px-1.5 py-1 text-muted`}>
          ✕
        </button>
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
      {state.error ? <span className="text-[10px] font-medium text-red-600">{state.error}</span> : null}
    </form>
  )
}
