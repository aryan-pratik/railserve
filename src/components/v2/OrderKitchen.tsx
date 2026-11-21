'use client'

import { useActionState, useId, useState, useTransition } from 'react'
import { Pencil, Plus, Printer } from 'lucide-react'
import { Button, ButtonLink, Chip, VegMark, cx, v2Focus } from './ui'
import { WorkspaceDialog } from './WorkspaceDialog'
import { ActionButton, ConfirmActionButton, FormNote, checkboxV2, inputV2, textareaV2, type FormState } from './OrderForms'
import { Select } from './Select'
import { formatRupees } from '@/lib/format'
import { DIETS, DIET_LABEL } from '@/lib/diet'
import type { WorkspaceItem } from '@/lib/v2/orderWorkspace'
import {
  acceptOrderV2,
  addOrderItemV2,
  adminOutcomeV2,
  checkKotDelayV2,
  generateKotV2,
  markPreparedV2,
  removeOrderItemV2,
  requestCancellationV2,
  setKotNoteV2,
  updateOrderItemV2,
  updateOrderRemarkV2,
} from '@/app/v2/orders/[id]/actions'

const initial: FormState = {}

/** Statuses an order can only be in if its KOT has already gone out once. */
const PRINTED = new Set(['KOT_PRINTED', 'PREPARED', 'DISPATCHED', 'DELIVERED', 'FAILED'])

const CANCEL_REQUEST_REASONS = [
  'Item finished, cannot prepare',
  'Kitchen cannot make it in time for the train',
  'Duplicate order',
  'Train cancelled or diverted',
]

const ADMIN_CANCEL_REASONS = [
  'Passenger cancelled',
  'Duplicate order',
  'Train cancelled or diverted',
  'Outlet cannot fulfil it',
]

type DelayInfo = Awaited<ReturnType<typeof checkKotDelayV2>>

function formatDelay(minutes: number | null): string {
  if (minutes === null) return 'an unknown amount'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h} h ${m} min` : `${m} min`
}

/**
 * The next kitchen step for this order, by status: Accept, Generate KOT (with
 * the late-train check), Mark ready, then "on the shelf". Preview and Reprint
 * ride alongside once a ticket exists.
 */
export function KitchenActions({
  orderId,
  externalOrderId,
  status,
  role,
  hasOutlet,
  canRequestCancel,
  adminCanCancel,
}: {
  orderId: string
  externalOrderId: string
  status: string
  role: 'ADMIN' | 'STORE_MANAGER' | 'TELECALLER'
  hasOutlet: boolean
  canRequestCancel: boolean
  adminCanCancel: boolean
}) {
  const kitchen = role === 'ADMIN' || role === 'STORE_MANAGER'
  const fields = { orderId }
  const steps: React.ReactNode[] = []

  if (kitchen && status === 'RECEIVED') {
    steps.push(
      <ActionButton key="accept" action={acceptOrderV2} fields={fields} variant="primary">
        Accept
      </ActionButton>,
    )
  }
  if (kitchen && status === 'ACCEPTED') {
    steps.push(<GenerateKotButton key="kot" orderId={orderId} />)
  }
  if (kitchen && status === 'KOT_PRINTED') {
    steps.push(
      <ActionButton key="ready" action={markPreparedV2} fields={fields} variant="primary">
        Mark ready
      </ActionButton>,
    )
  }
  if (kitchen && hasOutlet && (status === 'ACCEPTED' || status === 'KOT_PRINTED' || status === 'PREPARED')) {
    steps.push(
      <ButtonLink key="preview" href={`/v2/orders/${orderId}/kot`}>
        Preview KOT
      </ButtonLink>,
    )
  }
  if (kitchen && hasOutlet && PRINTED.has(status)) {
    steps.push(<ReprintKotButton key="reprint" orderId={orderId} />)
  }

  const wentWrong: React.ReactNode[] = []
  if (canRequestCancel) {
    wentWrong.push(
      <ConfirmActionButton
        key="request-cancel"
        action={requestCancellationV2}
        fields={fields}
        label="Request cancel"
        variant="danger"
        title="Ask to cancel this order?"
        description={
          <>
            <span className="font-mono font-semibold text-v2-ink">{externalOrderId}</span> is not cancelled yet: the call desk and the
            admin see your request and accept or refuse it. Keep the order going until they do.
          </>
        }
        submitLabel="Send request"
        reason
        reasonHint="Required. The call desk and the admin see this."
        quickReasons={CANCEL_REQUEST_REASONS}
      />,
    )
  }
  if (role === 'ADMIN' && adminCanCancel) {
    wentWrong.push(
      <ConfirmActionButton
        key="cancel"
        action={adminOutcomeV2}
        fields={{ orderId, to: 'CANCELLED' }}
        label="Cancel order"
        variant="danger"
        title="Cancel this order?"
        description={
          <>
            <span className="font-mono font-semibold text-v2-ink">{externalOrderId}</span> stops here: the kitchen is told immediately and
            no rider can pick it up.
          </>
        }
        submitLabel="Cancel the order"
        reason
        reasonHint="The kitchen and the history show this."
        quickReasons={ADMIN_CANCEL_REASONS}
      />,
    )
  }

  return (
    <div className="grid gap-3">
      {status === 'PREPARED' ? <Chip tone="ok">On the shelf, waiting for the rider</Chip> : null}
      {status === 'DISPATCHED' ? <Chip tone="out">Out for delivery</Chip> : null}
      {steps.length > 0 ? <div className="flex flex-wrap items-center gap-2">{steps}</div> : null}
      {steps.length === 0 && wentWrong.length === 0 ? <p className="text-sm text-v2-muted">Nothing further for the kitchen on this order.</p> : null}
      {wentWrong.length > 0 ? (
        <div className="grid gap-2 border-t border-v2-line pt-3">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-v2-faint">If something went wrong</span>
          <div className="flex flex-wrap items-center gap-2">{wentWrong}</div>
        </div>
      ) : null}
    </div>
  )
}

/** Generate KOT: asks first when the train is late beyond the threshold. */
function GenerateKotButton({ orderId }: { orderId: string }) {
  const [checking, start] = useTransition()
  const [delay, setDelay] = useState<DelayInfo | null>(null)
  const id = useId()

  function onClick() {
    start(async () => {
      try {
        const info = await checkKotDelayV2(orderId)
        if (info.delayed) {
          setDelay(info)
          return
        }
      } catch {
        // A train-status outage must never block the kitchen; print anyway.
      }
      const fd = new FormData()
      fd.set('orderId', orderId)
      await generateKotV2(fd)
    })
  }

  return (
    <>
      <Button type="button" variant="primary" onClick={onClick} disabled={checking} aria-busy={checking || undefined}>
        <Printer size={16} aria-hidden />
        {checking ? 'Checking the train' : 'Generate KOT'}
      </Button>
      {delay ? (
        <WorkspaceDialog
          title={
            <>
              <span className="font-mono">{delay.trainNo}</span> is running late
            </>
          }
          titleId={`${id}-delay`}
          onClose={() => setDelay(null)}
        >
          <p className="text-v2-muted">
            Running <b className="text-v2-ink">{formatDelay(delay.delayMinutes)}</b> late
            {delay.expected ? (
              <>
                , now expected{' '}
                <b className="font-mono text-v2-ink">
                  {new Date(delay.expected).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true })}
                </b>
              </>
            ) : null}
            . Print the KOT anyway?
          </p>
          <form action={generateKotV2} onSubmit={() => setDelay(null)} className="mt-4 flex flex-wrap gap-2">
            <input type="hidden" name="orderId" value={orderId} />
            <Button type="submit" variant="primary">
              Print anyway
            </Button>
            <Button type="button" variant="ghost" onClick={() => setDelay(null)}>
              Wait
            </Button>
          </form>
        </WorkspaceDialog>
      ) : null}
    </>
  )
}

/** Sends the ticket again without touching the status. */
export function ReprintKotButton({ orderId }: { orderId: string }) {
  const [pending, setPending] = useState(false)
  const [state, setState] = useState<FormState>(initial)

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
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button type="button" variant="ghost" onClick={() => void reprint()} disabled={pending} aria-busy={pending || undefined}>
        Reprint KOT
      </Button>
      <FormNote state={state} />
    </span>
  )
}

/** The note that prints on the KOT. Telecaller and admin write it. */
export function KotNoteForm({ orderId, kotNote }: { orderId: string; kotNote: string | null }) {
  const [state, action, pending] = useActionState(setKotNoteV2, initial)
  const id = useId()
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="orderId" value={orderId} />
      <label htmlFor={id} className="sr-only">
        KOT note
      </label>
      <textarea key={kotNote ?? ''} id={id} name="kotNote" defaultValue={kotNote ?? ''} maxLength={500} rows={3} placeholder="e.g. Call before leaving the platform" className={textareaV2} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={pending} aria-busy={pending || undefined}>
          Save KOT note
        </Button>
        <FormNote state={state} />
      </div>
      <p className="text-xs text-v2-muted">Prints on the KOT when the kitchen generates it.</p>
    </form>
  )
}

/** Admin's instruction for the kitchen; shown on the board, never printed. */
export function RemarkForm({ orderId, remark }: { orderId: string; remark: string | null }) {
  const [state, action, pending] = useActionState(updateOrderRemarkV2, initial)
  const id = useId()
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="orderId" value={orderId} />
      <label htmlFor={id} className="sr-only">
        Remark for the kitchen
      </label>
      <textarea key={remark ?? ''} id={id} name="remark" defaultValue={remark ?? ''} maxLength={500} rows={3} placeholder="e.g. Make it less spicy" className={textareaV2} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={pending} aria-busy={pending || undefined}>
          Save remark
        </Button>
        <FormNote state={state} />
      </div>
      <p className="text-xs text-v2-muted">Shown to the kitchen on the board; not printed.</p>
    </form>
  )
}

/* ── items ─────────────────────────────────────────────────────────────── */

/**
 * The order's food and packing lines. An admin edits in place: the pencil
 * swaps a row for its form, and "Add item" appends one at the bottom.
 */
export function OrderItems({
  orderId,
  items,
  canEdit,
  showMoney,
}: {
  orderId: string
  items: WorkspaceItem[]
  canEdit: boolean
  showMoney: boolean
}) {
  const food = items.filter((i) => !i.isPacking)
  const packing = items.filter((i) => i.isPacking)
  return (
    <div className="grid gap-1">
      {food.length === 0 ? <p className="py-2 text-sm text-v2-muted">No items on this order yet.</p> : null}
      {food.map((i) => (
        <ItemRow key={i.id} orderId={orderId} item={i} canEdit={canEdit} showMoney={showMoney} />
      ))}
      {packing.length > 0 ? (
        <>
          <span className="mt-2 text-[11px] font-bold uppercase tracking-[0.12em] text-v2-faint">Packing</span>
          {packing.map((i) => (
            <ItemRow key={i.id} orderId={orderId} item={i} canEdit={canEdit} showMoney={showMoney} />
          ))}
        </>
      ) : null}
      {canEdit ? <AddItem orderId={orderId} /> : null}
    </div>
  )
}

function ItemRow({ orderId, item, canEdit, showMoney }: { orderId: string; item: WorkspaceItem; canEdit: boolean; showMoney: boolean }) {
  const [editing, setEditing] = useState(false)
  if (editing) return <ItemForm orderId={orderId} item={item} onDone={() => setEditing(false)} />
  const tag = item.isPacking ? null : item.diet ? (item.confirmed ? null : 'suggested, not confirmed') : item.composite ? 'set veg / non-veg' : 'not tagged'
  return (
    <div className={cx('grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b border-v2-line py-2.5 last:border-b-0', item.isPacking && 'text-v2-muted')}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-semibold">
            {item.isPacking ? null : <VegMark diet={item.diet} />}
            {item.name}
          </span>
          <span className="font-mono text-v2-muted">×{item.qty}</span>
          {tag ? <Chip tone="warn">{tag}</Chip> : null}
        </div>
        {item.spec ? <pre className="mt-1.5 whitespace-pre-wrap rounded-v2-md bg-v2-sunken p-2.5 font-v2 text-xs text-v2-ink-2">{item.spec}</pre> : null}
        {item.notes ? <p className="mt-1 whitespace-pre-wrap text-xs italic text-v2-muted">{item.notes}</p> : null}
      </div>
      <div className="flex items-center gap-2">
        {showMoney && item.pricePaise !== null ? <span className="font-mono text-sm tabular-nums">{formatRupees(item.pricePaise)}</span> : null}
        {canEdit ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={`Edit ${item.name}`}
            className={cx('grid h-8 w-8 place-items-center rounded-full text-v2-muted hover:bg-v2-surface-2 hover:text-v2-ink', v2Focus)}
          >
            <Pencil size={14} aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  )
}

function ItemFields({ id, item }: { id: string; item?: WorkspaceItem }) {
  return (
    <>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_5rem_7rem]">
        <input id={`${id}-name`} name="name" defaultValue={item?.name ?? ''} placeholder="Item name" aria-label="Name" required className={inputV2} autoFocus={!item} />
        <input name="qty" type="number" min={1} step={1} defaultValue={item?.qty ?? 1} placeholder="Qty" aria-label="Quantity" className={inputV2} />
        <input name="pricePaise" type="number" min={0} step="0.01" defaultValue={item?.pricePaise != null ? (item.pricePaise / 100).toFixed(2) : ''} placeholder="Price ₹" aria-label="Price in rupees" className={inputV2} />
      </div>
      <textarea name="notes" defaultValue={item?.notes ?? ''} rows={2} placeholder="Notes (print on the KOT under the item)" aria-label="Notes" className={textareaV2} />
      <textarea name="spec" defaultValue={item?.spec ?? ''} rows={2} placeholder="Spec: what the combo or thali contains" aria-label="Spec" className={textareaV2} />
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-v2-muted">
        <label className="flex items-center gap-2">
          <input type="hidden" name="hasIsPacking" value="1" />
          <input type="checkbox" name="isPacking" defaultChecked={Boolean(item?.isPacking)} className={checkboxV2} />
          Packing item (tissue, spoon, water)
        </label>
        <span className="flex items-center gap-2">
          Veg / non-veg on this order
          <Select
            name="diet"
            defaultValue={item?.ownDiet ?? ''}
            size="sm"
            aria-label="Veg / non-veg on this order"
            className="w-auto min-w-[11rem]"
            buttonClassName="rounded-v2-md border-v2-line-strong"
            options={[{ value: '', label: 'As the menu says' }, ...DIETS.map((d) => ({ value: d, label: DIET_LABEL[d] }))]}
          />
        </span>
      </div>
    </>
  )
}

function ItemForm({ orderId, item, onDone }: { orderId: string; item: WorkspaceItem; onDone: () => void }) {
  const id = useId()
  const [state, action, pending] = useActionState(async (prev: FormState, fd: FormData) => {
    const res = await updateOrderItemV2(prev, fd)
    if (res.ok && !res.error) onDone()
    return res
  }, initial)
  const [removeState, removeAction, removing] = useActionState(removeOrderItemV2, initial)
  const [confirmRemove, setConfirmRemove] = useState(false)

  return (
    <div className="my-2 grid gap-3 rounded-v2-md border border-v2-line-strong bg-v2-surface-2 p-3">
      <form action={action} className="grid gap-2">
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="itemId" value={item.id} />
        <ItemFields id={id} item={item} />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" variant="primary" disabled={pending}>
            Save
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <FormNote state={state} />
        </div>
      </form>
      <form action={removeAction} className="flex flex-wrap items-center gap-2 border-t border-v2-line pt-2">
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="itemId" value={item.id} />
        {confirmRemove ? (
          <>
            <Button type="submit" size="sm" variant="danger" disabled={removing}>
              Remove {item.name}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>
              Keep it
            </Button>
          </>
        ) : (
          <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmRemove(true)}>
            Remove item
          </Button>
        )}
        <FormNote state={removeState} />
      </form>
    </div>
  )
}

function AddItem({ orderId }: { orderId: string }) {
  const [adding, setAdding] = useState(false)
  const id = useId()
  const [state, action, pending] = useActionState(async (prev: FormState, fd: FormData) => {
    const res = await addOrderItemV2(prev, fd)
    if (res.ok && !res.error) setAdding(false)
    return res
  }, initial)

  if (!adding) {
    return (
      <div className="flex flex-wrap items-center gap-2 pt-2">
        <Button type="button" size="sm" onClick={() => setAdding(true)}>
          <Plus size={14} aria-hidden />
          Add item
        </Button>
        {state.ok ? <FormNote state={state} /> : null}
      </div>
    )
  }
  return (
    <form action={action} className="my-2 grid gap-2 rounded-v2-md border border-v2-line-strong bg-v2-surface-2 p-3">
      <input type="hidden" name="orderId" value={orderId} />
      <ItemFields id={id} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={pending}>
          Add
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
          Cancel
        </Button>
        <FormNote state={state} />
      </div>
    </form>
  )
}
