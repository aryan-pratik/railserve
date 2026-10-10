'use client'

import { useActionState, useState } from 'react'
import { Button, FormNote, IconButton, inputClass, textareaClass } from '@/components/ui'
import { PAYMENT_MODES } from '@/lib/orderEnums'
import { ORDER_STATUSES } from '@/lib/orderStatus'
import { ORDER_EDIT_FIELDS, enumOptionLabel, type EditableField } from '@/lib/orderEditFields'
import { IconPencil, IconPlus } from '@/components/Icons'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Modal } from '@/components/Modal'
import {
  addOrderItemAction,
  adminTransitionAction,
  assignAgentsAction,
  deleteOrderAction,
  editOrderDetailsAction,
  overrideStatusAction,
  removeOrderItemAction,
  updateOrderItemAction,
  updateOrderPaymentModeAction,
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
        key={remark ?? ''}
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

/** Corrects how the order is paid (prepaid / COD / invoice). Admin-only. */
export function PaymentModeForm({ orderId, paymentMode }: { orderId: string; paymentMode: string | null }) {
  const [state, action, pending] = useActionState(updateOrderPaymentModeAction, initial)

  return (
    <form action={action} className="space-y-2 p-4">
      <input type="hidden" name="orderId" value={orderId} />
      <label htmlFor="order-payment-mode" className="sr-only">Payment mode</label>
      {/* Keyed by the value: the details form can change it too, and an
          uncontrolled select would go on showing the old one. On the select,
          not the form, so the form's "saved" note survives the refresh. */}
      <select key={paymentMode ?? ''} id="order-payment-mode" name="paymentMode" defaultValue={paymentMode ?? ''} className={inputClass}>
        <option value="">Not set</option>
        {PAYMENT_MODES.map((m) => (
          <option key={m} value={m}>{m === 'COD' ? 'COD' : m.charAt(0) + m.slice(1).toLowerCase()}</option>
        ))}
      </select>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" variant="secondary" pending={pending}>
          Save payment mode
        </Button>
        <FormNote state={state} />
      </div>
    </form>
  )
}

/** The checkbox, and the marker that tells the action it was on the form. */
function PackingBox({ id, checked }: { id: string; checked: boolean }) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-xs text-muted">
      <input type="hidden" name="hasIsPacking" value="1" />
      <input id={id} type="checkbox" name="isPacking" defaultChecked={checked} className="size-4 rounded border-line-strong accent-accent" />
      Packing item (tissue, spoon, water)
    </label>
  )
}

/**
 * Edit-in-place for one order item. Collapsed to a pencil button by default;
 * clicking it swaps the row for a small form so a wrong qty, price or name
 * doesn't need a full item delete/re-add. Stays open until the save goes
 * through, so a refused value is shown rather than lost with the form.
 */
export function EditOrderItem({
  orderId, itemId, name, qty, pricePaise, notes, spec, isPacking,
}: {
  orderId: string
  itemId: string
  name: string
  qty: number
  pricePaise?: number | null
  notes?: string | null
  spec?: string | null
  isPacking?: boolean | null
}) {
  const [editing, setEditing] = useState(false)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [state, action, pending] = useActionState(async (prev: ActionState, fd: FormData) => {
    const res = await updateOrderItemAction(prev, fd)
    if (res.ok && !res.error) setEditing(false)
    return res
  }, initial)
  const [removeState, removeAction, removing] = useActionState(removeOrderItemAction, initial)

  if (!editing) {
    return (
      <>
        <IconButton aria-label={`Edit ${name}`} size="sm" onClick={() => setEditing(true)}>
          <IconPencil size={14} />
        </IconButton>
        {state.ok ? <FormNote state={state} /> : null}
      </>
    )
  }

  return (
    <div className="mt-2 w-full space-y-2 rounded-lg border border-line-strong bg-sunken p-3">
      <form action={action} className="space-y-2">
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
          placeholder="Notes (prints on the KOT under the item)"
          className={textareaClass}
        />
        <label className="sr-only" htmlFor={`item-spec-${itemId}`}>Spec</label>
        <textarea
          id={`item-spec-${itemId}`}
          name="spec"
          defaultValue={spec ?? ''}
          rows={2}
          placeholder="Spec: what the combo or thali contains"
          className={textareaClass}
        />
        <PackingBox id={`item-packing-${itemId}`} checked={Boolean(isPacking)} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" variant="secondary" pending={pending}>Save</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          <FormNote state={state} />
        </div>
      </form>
      <form action={removeAction} className="flex flex-wrap items-center gap-3 border-t border-line pt-2">
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="itemId" value={itemId} />
        {confirmingRemove ? (
          <>
            <Button type="submit" size="sm" variant="danger" pending={removing}>Remove {name}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmingRemove(false)}>Keep it</Button>
          </>
        ) : (
          <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmingRemove(true)}>Remove item</Button>
        )}
        <FormNote state={removeState} />
      </form>
    </div>
  )
}

/**
 * Adds a new item to the order — same shape as EditOrderItem's form, but
 * with nothing pre-filled and no item id: it appends rather than replaces.
 */
export function AddOrderItem({ orderId }: { orderId: string }) {
  const [adding, setAdding] = useState(false)
  const [state, action, pending] = useActionState(async (prev: ActionState, fd: FormData) => {
    const res = await addOrderItemAction(prev, fd)
    if (res.ok && !res.error) setAdding(false)
    return res
  }, initial)

  if (!adding) {
    return (
      <div className="flex flex-wrap items-center gap-3 p-4">
        <Button type="button" size="sm" variant="secondary" onClick={() => setAdding(true)}>
          <IconPlus size={14} />
          Add item
        </Button>
        {state.ok ? <FormNote state={state} /> : null}
      </div>
    )
  }

  return (
    <form
      action={action}
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
      <PackingBox id="new-item-packing" checked={false} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" variant="secondary" pending={pending}>Add</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
        <FormNote state={state} />
      </div>
    </form>
  )
}

function DetailInput({
  field, value, outlets,
}: {
  field: EditableField
  value: string
  outlets: { id: string; label: string }[]
}) {
  const id = `order-field-${field.key}`
  const common = { id, name: field.key, defaultValue: value }
  let control: React.ReactNode
  switch (field.kind) {
    case 'enum':
      control = (
        <select {...common} className={inputClass}>
          {field.required ? null : <option value="">Not set</option>}
          {field.options!.map((o) => (
            <option key={o} value={o}>{enumOptionLabel(field.key, o)}</option>
          ))}
        </select>
      )
      break
    case 'outlet':
      control = (
        <select {...common} className={inputClass}>
          <option value="">No outlet</option>
          {outlets.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      )
      break
    case 'longtext':
      control = <textarea {...common} rows={2} maxLength={field.max} className={textareaClass} />
      break
    case 'money':
      control = <input {...common} type="number" min={0} step="0.01" placeholder="₹" className={inputClass} />
      break
    case 'int':
      control = <input {...common} type="number" min={1} step={1} className={inputClass} />
      break
    case 'date':
      control = <input {...common} type="date" required className={inputClass} />
      break
    case 'datetime':
      control = <input {...common} type="datetime-local" className={inputClass} />
      break
    default:
      control = <input {...common} type="text" maxLength={field.max} required={field.required} className={inputClass} />
  }
  return (
    <div className={field.kind === 'longtext' ? 'space-y-1 sm:col-span-2' : 'space-y-1'}>
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {field.label}
        {field.kind === 'money' ? ' (₹)' : field.kind === 'datetime' ? ' (IST)' : ''}
      </label>
      {control}
      <input type="hidden" name={`orig.${field.key}`} value={value} />
    </div>
  )
}

/**
 * Every editable detail of the order in one form. Opens in a modal from a
 * button: the page is for reading, and a wall of inputs would bury what it says.
 * Each field that changes is logged on its own, old value and new.
 */
export function OrderDetailsEditor({
  orderId, values, outlets,
}: {
  orderId: string
  /** Form-ready strings, keyed by field: dates as IST datetime-local, money in rupees. */
  values: Record<string, string>
  outlets: { id: string; label: string }[]
}) {
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(async (prev: ActionState, fd: FormData) => {
    const res = await editOrderDetailsAction(prev, fd)
    if (res.ok && !res.error) setOpen(false)
    return res
  }, initial)

  const formId = `order-details-form-${orderId}`
  const close = () => setOpen(false)

  return (
    <div className="flex flex-wrap items-center gap-3 p-4">
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <IconPencil size={14} />
        Edit order details
      </Button>
      {state.ok ? <FormNote state={state} /> : null}
      <p className="w-full text-xs text-muted text-pretty">
        Train, seat, contact, outlet, amount, payment and the rest. Every change is written to the event log.
      </p>

      {open ? (
        <Modal
          title="Edit order details"
          titleId={`order-details-modal-${orderId}`}
          onClose={close}
          maxWidthClassName="max-w-2xl"
          footer={
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" form={formId} size="sm" pending={pending}>Save changes</Button>
              <Button type="button" size="sm" variant="ghost" onClick={close}>Cancel</Button>
              <FormNote state={state} />
            </div>
          }
        >
          {/* key: a save re-renders this with the new values, and the inputs are
              uncontrolled, so remounting is what makes them show the saved ones. */}
          <form id={formId} key={JSON.stringify(values)} action={action} className="p-5">
            <input type="hidden" name="orderId" value={orderId} />
            <div className="grid gap-3 sm:grid-cols-2">
              {ORDER_EDIT_FIELDS.map((f) => (
                <DetailInput key={f.key} field={f} value={values[f.key] ?? ''} outlets={outlets} />
              ))}
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  )
}

/**
 * Sets any status at all, off the pipeline if need be: the same escape hatch
 * as the status cell on the orders list, from the order's own page.
 */
export function StatusOverride({ orderId, status }: { orderId: string; status: string }) {
  const [state, action, pending] = useActionState(overrideStatusAction, initial)
  return (
    <form action={action} className="space-y-2 border-t border-line p-4">
      <input type="hidden" name="orderId" value={orderId} />
      <label htmlFor="order-status-override" className="text-xs font-medium text-muted">Set any status</label>
      <div className="flex gap-2">
        <input
          id="order-status-override"
          name="to"
          list="order-status-options"
          placeholder={status}
          className={inputClass}
          autoComplete="off"
        />
        <datalist id="order-status-options">
          {ORDER_STATUSES.map((s) => <option key={s} value={s} />)}
        </datalist>
        <Button type="submit" size="sm" variant="secondary" pending={pending}>Set</Button>
      </div>
      <FormNote state={state} />
    </form>
  )
}
