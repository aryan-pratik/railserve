'use client'

import { useActionState, useState } from 'react'
import { Button, FormNote, IconButton, inputClass, textareaClass } from '@/components/ui'
import { IconPencil, IconPlus } from '@/components/Icons'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import {
  addOrderItemAction,
  adminTransitionAction,
  assignAgentsAction,
  deleteOrderAction,
  updateOrderItemAction,
  updateOrderRemarkAction,
  type ActionState,
} from './actions'

const initial: ActionState = {}

/**
 * Corrects who is recorded as having delivered an order.
 *
 * Riders are not assigned work; the system writes whoever actually dispatched
 * or delivered. This is the exception path: someone used a colleague's phone,
 * a record is wrong. It edits history, so it is an admin-only, per-order control.
 */
export function AssignAgents({
  orderId, agents, assigned,
}: {
  orderId: string
  agents: { id: string; name: string; phone: string }[]
  assigned: string[]
}) {
  const [state, action, pending] = useActionState(assignAgentsAction, initial)

  return (
    <form action={action} className="space-y-3 p-4">
      <input type="hidden" name="orderId" value={orderId} />
      {agents.length === 0 ? (
        <p className="text-sm text-muted">No active riders. Add one under Setup, Staff.</p>
      ) : (
        <div className="space-y-1">
          {agents.map((a) => (
            <label key={a.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1.5 text-sm hover:bg-sunken">
              <input
                type="checkbox" name="agentIds" value={a.id}
                defaultChecked={assigned.includes(a.id)}
                className="size-4 rounded border-line-strong accent-accent"
              />
              <span className="font-medium text-ink">{a.name}</span>
              <span className="font-mono text-xs tabular-nums text-faint">{a.phone}</span>
            </label>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" variant="secondary" pending={pending} disabled={agents.length === 0}>
          Correct the record
        </Button>
        <FormNote state={state} />
      </div>
      <p className="text-xs text-muted text-pretty">
        Normally filled in by whoever delivered. More than one is valid: a large bulk handover is not a one-rider job.
      </p>
    </form>
  )
}

/**
 * Sends the KOT again for an order the kitchen has already moved past.
 *
 * The transition button only prints on the ACCEPTED -> KOT_PRINTED edge, which
 * is gone the moment the order advances. This is the "the ticket never came
 * out" call: the print route already accepts an admin, so this is the missing
 * control, not a new permission.
 */
export function ReprintKotButton({ orderId }: { orderId: string }) {
  const [pending, setPending] = useState(false)
  const [state, setState] = useState<ActionState>(initial)

  async function reprint() {
    setPending(true)
    setState(initial)
    try {
      const res = await fetch(`/api/store/orders/${orderId}/kot`, { method: 'POST' })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.ok) throw new Error(body?.error ?? `Reprint failed (${res.status})`)
      setState({ ok: 'KOT sent to the kitchen printer.' })
    } catch (err) {
      setState({ error: err instanceof Error ? err.message : 'Reprint failed' })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-line p-4">
      <Button type="button" size="sm" variant="secondary" pending={pending} onClick={() => void reprint()}>
        Reprint KOT
      </Button>
      <FormNote state={state} />
    </div>
  )
}

function TransitionButtonRow({
  orderId, action, pending, options,
}: {
  orderId: string
  action: (formData: FormData) => void
  pending: boolean
  options: { to: string; label: string; tone: 'primary' | 'danger' }[]
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <form key={o.to} action={action}>
          <input type="hidden" name="orderId" value={orderId} />
          <input type="hidden" name="to" value={o.to} />
          <Button type="submit" size="sm" variant={o.tone} pending={pending}>
            {o.label}
          </Button>
        </form>
      ))}
    </div>
  )
}

/**
 * The order's next moves, in two rows rather than one flat, arbitrarily
 * ordered list: moving it forward through the kitchen (primary) on top, and
 * an outcome that ends it early — cancel, misdelivery, refund, lost — below.
 * Keeping them apart means "what happens next in the normal case" and "what
 * went wrong" never compete for the same glance.
 */
export function TransitionButtons({
  orderId, options,
}: {
  orderId: string
  options: { to: string; label: string; tone: 'primary' | 'danger' }[]
}) {
  const [state, action, pending] = useActionState(adminTransitionAction, initial)

  if (options.length === 0) {
    return <p className="px-4 py-4 text-sm text-muted">Nothing further to do on this order.</p>
  }

  const forward = options.filter((o) => o.tone === 'primary')
  const outcomes = options.filter((o) => o.tone === 'danger')

  return (
    <div className="space-y-3 p-4">
      {forward.length > 0 ? (
        <TransitionButtonRow orderId={orderId} action={action} pending={pending} options={forward} />
      ) : null}
      {outcomes.length > 0 ? (
        <div className="space-y-1.5">
          {forward.length > 0 ? (
            <p className="text-xs font-medium uppercase tracking-wide text-faint">
              If something went wrong
            </p>
          ) : null}
          <TransitionButtonRow orderId={orderId} action={action} pending={pending} options={outcomes} />
        </div>
      ) : null}
      <FormNote state={state} />
    </div>
  )
}

/**
 * Permanently removes the order. No status transition undoes this — unlike
 * Cancel, the record and its event log are gone, so the confirm step spells
 * out the order id being deleted rather than just asking "are you sure".
 */
export function DeleteOrderButton({ orderId, externalOrderId }: { orderId: string; externalOrderId: string }) {
  const [state, action, pending] = useActionState(deleteOrderAction, initial)
  const [confirming, setConfirming] = useState(false)

  return (
    <div className="space-y-2 p-4">
      <Button type="button" variant="danger" size="sm" onClick={() => setConfirming(true)}>
        Delete order
      </Button>
      <FormNote state={state} />

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
    </div>
  )
}

/**
 * Free-text instruction for the kitchen ("less spicy"), separate from the
 * read-only creation-time Notes and never printed on the KOT.
 */
export function RemarkForm({ orderId, remark }: { orderId: string; remark: string | null }) {
  const [state, action, pending] = useActionState(updateOrderRemarkAction, initial)

  return (
    <form action={action} className="space-y-2 p-4">
      <input type="hidden" name="orderId" value={orderId} />
      <label htmlFor="order-remark" className="sr-only">Remark</label>
      <textarea
        id="order-remark"
        name="remark"
        defaultValue={remark ?? ''}
        maxLength={500}
        rows={3}
        placeholder="e.g. Make it less spicy"
        className={textareaClass}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" variant="secondary" pending={pending}>
          Save remark
        </Button>
        <FormNote state={state} />
      </div>
    </form>
  )
}

/**
 * Edit-in-place for one order item. Collapsed to a pencil button by default;
 * clicking it swaps the row for a small form so a wrong qty, price or name
 * doesn't need a full item delete/re-add.
 */
export function EditOrderItem({
  orderId, itemId, name, qty, pricePaise, notes,
}: {
  orderId: string
  itemId: string
  name: string
  qty: number
  pricePaise?: number | null
  notes?: string | null
}) {
  const [state, action, pending] = useActionState(updateOrderItemAction, initial)
  const [editing, setEditing] = useState(false)

  if (!editing) {
    return (
      <IconButton aria-label={`Edit ${name}`} size="sm" onClick={() => setEditing(true)}>
        <IconPencil size={14} />
      </IconButton>
    )
  }

  return (
    <form
      action={action}
      onSubmit={() => setEditing(false)}
      className="mt-2 space-y-2 rounded-lg border border-line-strong bg-sunken p-3"
    >
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="itemId" value={itemId} />
      <div className="grid gap-2 sm:grid-cols-[1fr_5rem_7rem]">
        <label className="sr-only" htmlFor={`item-name-${itemId}`}>Name</label>
        <input id={`item-name-${itemId}`} name="name" defaultValue={name} className={inputClass} placeholder="Item name" />
        <label className="sr-only" htmlFor={`item-qty-${itemId}`}>Quantity</label>
        <input id={`item-qty-${itemId}`} name="qty" type="number" min={1} step={1} defaultValue={qty} className={inputClass} placeholder="Qty" />
        <label className="sr-only" htmlFor={`item-price-${itemId}`}>Price (₹)</label>
        <input
          id={`item-price-${itemId}`}
          name="pricePaise"
          type="number"
          min={0}
          step="0.01"
          defaultValue={pricePaise != null ? (pricePaise / 100).toFixed(2) : ''}
          placeholder="Price ₹"
          className={inputClass}
        />
      </div>
      <label className="sr-only" htmlFor={`item-notes-${itemId}`}>Notes</label>
      <textarea
        id={`item-notes-${itemId}`}
        name="notes"
        defaultValue={notes ?? ''}
        rows={2}
        placeholder="Notes"
        className={textareaClass}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" variant="secondary" pending={pending}>Save</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
        <FormNote state={state} />
      </div>
    </form>
  )
}

/**
 * Adds a new item to the order — same shape as EditOrderItem's form, but
 * with nothing pre-filled and no item id: it appends rather than replaces.
 */
export function AddOrderItem({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState(addOrderItemAction, initial)
  const [adding, setAdding] = useState(false)

  if (!adding) {
    return (
      <div className="p-4">
        <Button type="button" size="sm" variant="secondary" onClick={() => setAdding(true)}>
          <IconPlus size={14} />
          Add item
        </Button>
      </div>
    )
  }

  return (
    <form
      action={action}
      onSubmit={() => setAdding(false)}
      className="m-4 space-y-2 rounded-lg border border-line-strong bg-sunken p-3"
    >
      <input type="hidden" name="orderId" value={orderId} />
      <div className="grid gap-2 sm:grid-cols-[1fr_5rem_7rem]">
        <label className="sr-only" htmlFor="new-item-name">Name</label>
        <input id="new-item-name" name="name" autoFocus className={inputClass} placeholder="Item name" />
        <label className="sr-only" htmlFor="new-item-qty">Quantity</label>
        <input id="new-item-qty" name="qty" type="number" min={1} step={1} defaultValue={1} className={inputClass} placeholder="Qty" />
        <label className="sr-only" htmlFor="new-item-price">Price (₹)</label>
        <input id="new-item-price" name="pricePaise" type="number" min={0} step="0.01" className={inputClass} placeholder="Price ₹" />
      </div>
      <label className="sr-only" htmlFor="new-item-notes">Notes</label>
      <textarea id="new-item-notes" name="notes" rows={2} placeholder="Notes" className={textareaClass} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" variant="secondary" pending={pending}>Add</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
        <FormNote state={state} />
      </div>
    </form>
  )
}
