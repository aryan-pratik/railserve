'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { formatRupees, formatServiceDate, formatShortDate, formatTimeIST, paiseToRupees } from '@/lib/format'
import {
  Button, CoachChip, Dash, EmptyState, IconButton, SourceBadge,
  StatusBadge, TypeBadge, editInputClass, editTriggerClass, statusLabel, thClass,
} from '@/components/ui'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { IconTrash } from '@/components/Icons'
import { TableFrame } from '@/components/OrdersTable'
import { CallNoteHint } from '@/components/CallNoteHint'
import { deleteOrderAction, updateOrderAmountAction, updateOrderStatusAction, type ActionState } from './actions'

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
  /** The aggregator the order arrived from — Order.source. */
  source?: Maybe<string>
  remark?: Maybe<string>
  /** Who has the order, from delivery.agentIds; comma-joined when several. */
  rider?: Maybe<string>
  /** Call-note count and prebuilt tooltip text — see callNoteSummary. */
  callNoteCount?: Maybe<number>
  callNoteHint?: Maybe<string>
}

/**
 * Same shape as OrdersTable's shared colgroup, plus a narrow trailing column
 * for the delete action — kept local rather than widening the shared one,
 * since store history and the board's flat view must not gain this column.
 */
function AdminColGroup({
  showOutlet,
  showSource = false,
  showRider = false,
}: {
  showOutlet: boolean
  showSource?: boolean
  showRider?: boolean
}) {
  const weights = [
    17, // order id
    10, // date
    10, // train
    11, // seat
    10, // passenger
    // The rider column is paid for out of remark, which truncates with a
    // tooltip; the aggregator badge does not truncate, so it gets a little more.
    ...(showSource ? [showRider ? 13 : 11] : []), // aggregator
    ...(showOutlet ? [11] : []), // outlet
    ...(showRider ? [10] : []), // rider
    showRider ? 9 : 14, // remark
    8, // amount
    13, // status
    9, // delete
  ]
  const total = weights.reduce((a, b) => a + b, 0)
  return (
    <colgroup>
      {weights.map((w, i) => (
        <col key={i} style={{ width: `${((w / total) * 100).toFixed(3)}%` }} />
      ))}
    </colgroup>
  )
}

const INITIAL_STATE: ActionState = {}

/**
 * Admin-only variant of OrdersTable with Amount and Status editable in place.
 * Kept separate from the shared OrdersTable (used by store history and the
 * store board's flat view) so those never gain an edit affordance.
 */
export function AdminOrdersTable({
  orders,
  showOutlet = false,
  showSource = false,
  showRider = false,
  statusOptions,
  emptyNote = 'Nothing matches these filters.',
}: {
  orders: AdminOrderRow[]
  showOutlet?: boolean
  /** Which aggregator each order came from. */
  showSource?: boolean
  /** Who has each order. */
  showRider?: boolean
  statusOptions: string[]
  emptyNote?: string
}) {
  if (orders.length === 0) {
    return <EmptyState title="No orders" note={emptyNote} />
  }

  return (
    <TableFrame>
      <table className={`w-full table-fixed text-sm ${showRider ? 'min-w-[68rem]' : 'min-w-[60rem]'}`}>
        <AdminColGroup showOutlet={showOutlet} showSource={showSource} showRider={showRider} />
        <thead className="border-b border-line bg-sunken/60">
          <tr>
            <th className={thClass}>Order</th>
            <th className={thClass}>Date</th>
            <th className={thClass}>Train</th>
            <th className={thClass}>Seat</th>
            <th className={thClass}>Passenger</th>
            {showSource ? <th className={thClass}>Aggregator</th> : null}
            {showOutlet ? <th className={thClass}>Outlet</th> : null}
            {showRider ? <th className={thClass}>Rider</th> : null}
            <th className={thClass}>Remark</th>
            <th className={`${thClass} text-right`}>Amount</th>
            <th className={thClass}>Status</th>
            <th className={thClass}><span className="sr-only">Delete</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {orders.map((o) => (
            <AdminOrderRow key={o.id} order={o} showOutlet={showOutlet} showSource={showSource} showRider={showRider} statusOptions={statusOptions} />
          ))}
        </tbody>
      </table>
    </TableFrame>
  )
}

function AdminOrderRow({
  order,
  showOutlet,
  showSource,
  showRider,
  statusOptions,
}: {
  order: AdminOrderRow
  showOutlet: boolean
  showSource: boolean
  showRider: boolean
  statusOptions: string[]
}) {
  const [editing, setEditing] = useState<'amount' | 'status' | null>(null)

  return (
    <tr className="transition-colors hover:bg-sunken/60">
      <td className="px-3 py-2.5">
        <Link href={`/admin/orders/${order.id}`} className="flex min-w-0 flex-wrap items-center gap-1.5 font-medium text-accent hover:underline">
          {/* Grouped with the id, so on this wrapping row the hint can never
              be the item that drops to a second line by itself. */}
          <span className="flex min-w-0 items-center gap-1">
            <span className="min-w-0 break-words font-mono text-xs">{order.externalOrderId}</span>
            <CallNoteHint orderId={order.id} count={order.callNoteCount} hint={order.callNoteHint} />
          </span>
          <TypeBadge type={order.orderType} />
        </Link>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-muted" title={formatServiceDate(order.serviceDate)}>
        {formatShortDate(order.serviceDate)}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5">
        <div className="font-mono tabular-nums text-ink">{order.trainNo ?? <Dash />}</div>
        {order.scheduledArrival ? (
          <div className="text-xs tabular-nums text-muted">{formatTimeIST(order.scheduledArrival)}</div>
        ) : null}
      </td>
      <td className="px-3 py-2.5">
        <CoachChip coach={order.coach} berth={order.berth} rawSeat={order.rawSeat} />
      </td>
      <td className="truncate px-3 py-2.5 text-ink" title={order.contactName ?? undefined}>{order.contactName ?? <Dash />}</td>
      {showSource ? <td className="px-3 py-2.5"><SourceBadge source={order.source} /></td> : null}
      {showOutlet ? <td className="truncate px-3 py-2.5 text-muted" title={order.outletName ?? undefined}>{order.outletName ?? <Dash />}</td> : null}
      {showRider ? <td className="truncate px-3 py-2.5 text-ink" title={order.rider || undefined}>{order.rider || <Dash />}</td> : null}
      <td className="truncate px-3 py-2.5 text-amber-800" title={order.remark ?? undefined}>
        {order.remark ?? <Dash />}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-ink">
        {editing === 'amount' ? (
          <AmountEditor orderId={order.id} initial={order.amountPaise} onDone={() => setEditing(null)} />
        ) : (
          <button type="button" onClick={() => setEditing('amount')} className={`${editTriggerClass} ml-auto`} title="Click to edit">
            {formatRupees(order.amountPaise)}
          </button>
        )}
      </td>
      <td className="px-3 py-2.5">
        {editing === 'status' ? (
          <StatusEditor orderId={order.id} current={order.status} options={statusOptions} onDone={() => setEditing(null)} />
        ) : (
          <button type="button" onClick={() => setEditing('status')} className={editTriggerClass} title="Click to edit">
            <StatusBadge status={order.status} />
          </button>
        )}
      </td>
      <td className="px-3 py-2.5 text-center">
        <DeleteOrderCell orderId={order.id} externalOrderId={order.externalOrderId} />
      </td>
    </tr>
  )
}

/** Row-scoped: the confirm dialog names this order specifically, not "this order". */
function DeleteOrderCell({ orderId, externalOrderId }: { orderId: string; externalOrderId: string }) {
  const [state, action, pending] = useActionState(deleteOrderAction, INITIAL_STATE)
  const [confirming, setConfirming] = useState(false)

  return (
    <>
      <IconButton
        aria-label={`Delete order ${externalOrderId}`}
        size="sm"
        onClick={() => setConfirming(true)}
        className="text-faint hover:bg-red-50 hover:text-red-700"
      >
        <IconTrash size={14} />
      </IconButton>

      {confirming ? (
        <ConfirmDialog
          titleId={`delete-order-${orderId}`}
          title="Delete this order?"
          onCancel={() => setConfirming(false)}
          actions={
            <>
              <form action={action} className="flex-1" onSubmit={() => setConfirming(false)}>
                <input type="hidden" name="orderId" value={orderId} />
                <Button type="submit" variant="danger" className="w-full" pending={pending}>
                  Delete
                </Button>
              </form>
              <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </>
          }
        >
          <span className="font-mono">{externalOrderId}</span> and its full event log will be
          permanently removed. This cannot be undone.
        </ConfirmDialog>
      ) : null}
      {state.error ? (
        <div role="alert" className="mt-1 text-[11px] font-medium text-red-600">{state.error}</div>
      ) : null}
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
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state.ok) onDone()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok])

  return (
    <form ref={formRef} action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="orderId" value={orderId} />
      <input
        name="amountRupees"
        defaultValue={paiseToRupees(initial)}
        inputMode="decimal"
        autoFocus
        disabled={pending}
        className={`${editInputClass} w-20 text-right`}
        aria-label="Amount in rupees"
        // Blur or Enter commits, spreadsheet-style — no separate save step.
        onBlur={() => formRef.current?.requestSubmit()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onDone()
          if (e.key === 'Enter') {
            e.preventDefault()
            formRef.current?.requestSubmit()
          }
        }}
      />
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
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state.ok) onDone()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok])

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="to" value={isCustom ? custom : choice} />
      <select
        value={choice}
        onChange={(e) => {
          const next = e.target.value
          setChoice(next)
          // Picking a value commits it immediately, spreadsheet-style — no separate save step.
          if (next !== ADD_NEW) requestAnimationFrame(() => formRef.current?.requestSubmit())
        }}
        onBlur={() => { if (!isCustom) onDone() }}
        disabled={pending}
        className={`${editInputClass} w-full`}
        aria-label="Status"
        autoFocus
        onKeyDown={(e) => { if (e.key === 'Escape') onDone() }}
      >
        {options.map((s) => (
          <option key={s} value={s}>{statusLabel(s)}</option>
        ))}
        <option value={ADD_NEW}>Add a new status…</option>
      </select>
      {isCustom ? (
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onBlur={() => { if (!custom.trim()) onDone() }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onDone()
            if (e.key === 'Enter' && custom.trim()) {
              e.preventDefault()
              formRef.current?.requestSubmit()
            }
          }}
          placeholder="e.g. Refund pending: press Enter"
          autoFocus
          disabled={pending}
          className={editInputClass}
          aria-label="New status name"
        />
      ) : null}
      {state.error ? <span role="alert" className="text-[11px] font-medium text-red-600">{state.error}</span> : null}
    </form>
  )
}
