'use client'

import { useActionState, useId, useState } from 'react'
import { Pencil } from 'lucide-react'
import { Button, cx } from './ui'
import { WorkspaceDialog } from './WorkspaceDialog'
import { ConfirmActionButton, FormNote, inputV2, textareaV2, type FormState } from './OrderForms'
import { Select } from './Select'
import { PAYMENT_MODES } from '@/lib/orderEnums'
import { ORDER_STATUSES } from '@/lib/orderStatus'
import { ORDER_EDIT_FIELDS, enumOptionLabel, type EditableField } from '@/lib/orderEditFields'
import { deleteOrderV2, editOrderDetailsV2, overrideStatusV2, updateOrderPaymentModeV2 } from '@/app/v2/orders/[id]/actions'

const initial: FormState = {}

/** The dropdown in the square shape of the workspace's other fields. */
const formSelectButton = 'rounded-v2-md border-v2-line-strong'

/** Corrects how the order is paid. Ingest guesses; the KOT and the board read it. */
export function PaymentModeForm({ orderId, paymentMode }: { orderId: string; paymentMode: string | null }) {
  const [state, action, pending] = useActionState(updateOrderPaymentModeV2, initial)
  const id = useId()
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="orderId" value={orderId} />
      <label htmlFor={id} className="text-xs font-semibold text-v2-ink-2">
        Payment mode
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          key={paymentMode ?? ''}
          id={id}
          name="paymentMode"
          defaultValue={paymentMode ?? ''}
          className="w-auto min-w-[11rem]"
          buttonClassName={formSelectButton}
          options={[
            { value: '', label: 'Not set' },
            ...PAYMENT_MODES.map((m) => ({ value: m, label: m === 'COD' ? 'Cash on delivery' : m.charAt(0) + m.slice(1).toLowerCase() })),
          ]}
        />
        <Button type="submit" size="sm" disabled={pending} aria-busy={pending || undefined}>
          Save
        </Button>
        <FormNote state={state} />
      </div>
    </form>
  )
}

function DetailInput({ field, value, outlets }: { field: EditableField; value: string; outlets: { id: string; label: string }[] }) {
  const id = `order-field-${field.key}`
  const common = { id, name: field.key, defaultValue: value }
  let control: React.ReactNode
  switch (field.kind) {
    case 'enum':
      control = (
        <Select
          {...common}
          buttonClassName={formSelectButton}
          options={[...(field.required ? [] : [{ value: '', label: 'Not set' }]), ...field.options!.map((o) => ({ value: o, label: enumOptionLabel(field.key, o) }))]}
        />
      )
      break
    case 'outlet':
      control = (
        <Select {...common} buttonClassName={formSelectButton} options={[{ value: '', label: 'No outlet' }, ...outlets.map((o) => ({ value: o.id, label: o.label }))]} />
      )
      break
    case 'longtext':
      control = <textarea {...common} rows={2} maxLength={field.max} className={textareaV2} />
      break
    case 'money':
      control = <input {...common} type="number" min={0} step="0.01" placeholder="₹" className={inputV2} />
      break
    case 'int':
      control = <input {...common} type="number" min={1} step={1} className={inputV2} />
      break
    case 'date':
      control = <input {...common} type="date" required className={inputV2} />
      break
    case 'datetime':
      control = <input {...common} type="datetime-local" className={inputV2} />
      break
    default:
      control = <input {...common} type="text" maxLength={field.max} required={field.required} className={inputV2} />
  }
  return (
    <div className={cx('grid gap-1', field.kind === 'longtext' && 'sm:col-span-2')}>
      <label htmlFor={id} className="text-xs font-semibold text-v2-ink-2">
        {field.label}
        {field.kind === 'money' ? ' (₹)' : field.kind === 'datetime' ? ' (IST)' : ''}
      </label>
      {control}
      {/* The value the form opened with: only changed fields are sent on. */}
      <input type="hidden" name={`orig.${field.key}`} value={value} />
    </div>
  )
}

/** Every editable detail in one dialog. Each changed field is logged on its own. */
export function EditOrderDetails({ orderId, values, outlets }: { orderId: string; values: Record<string, string>; outlets: { id: string; label: string }[] }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const [state, action, pending] = useActionState(async (prev: FormState, fd: FormData) => {
    const res = await editOrderDetailsV2(prev, fd)
    if (res.ok && !res.error) setOpen(false)
    return res
  }, initial)

  return (
    <>
      <span className="inline-flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={() => setOpen(true)}>
          <Pencil size={14} aria-hidden />
          Edit details
        </Button>
        {state.ok && !open ? <FormNote state={state} /> : null}
      </span>
      {open ? (
        <WorkspaceDialog
          title="Edit order details"
          titleId={`${id}-title`}
          onClose={() => setOpen(false)}
          wide
          footer={
            <>
              <Button type="submit" form={`${id}-form`} variant="primary" disabled={pending} aria-busy={pending || undefined}>
                Save changes
              </Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <FormNote state={state} />
            </>
          }
        >
          <p className="mb-3 text-v2-muted">Train, seat, contact, outlet, amount, payment and the rest. Every change is written to the history.</p>
          <form id={`${id}-form`} key={JSON.stringify(values)} action={action} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="orderId" value={orderId} />
            {ORDER_EDIT_FIELDS.map((f) => (
              <DetailInput key={f.key} field={f} value={values[f.key] ?? ''} outlets={outlets} />
            ))}
          </form>
        </WorkspaceDialog>
      ) : null}
    </>
  )
}

/** Sets any status, off the pipeline if need be, after a confirm. */
export function StatusOverride({ orderId, status }: { orderId: string; status: string }) {
  const [to, setTo] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [state, action, pending] = useActionState(async (prev: FormState, fd: FormData) => {
    const res = await overrideStatusV2(prev, fd)
    if (res.ok) {
      setConfirming(false)
      setTo('')
    }
    return res
  }, initial)
  const id = useId()
  const listId = `${id}-statuses`

  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-xs font-semibold text-v2-ink-2">
        Set any status
      </label>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (to.trim()) setConfirming(true)
        }}
      >
        <input id={id} value={to} onChange={(e) => setTo(e.target.value)} list={listId} placeholder={status} autoComplete="off" className={cx(inputV2, 'w-auto min-w-[14rem] font-mono')} />
        <datalist id={listId}>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <Button type="submit" size="sm" disabled={!to.trim()}>
          Set
        </Button>
        <FormNote state={state} />
      </form>
      <p className="text-xs text-v2-muted">Skips the usual steps and side effects. Logged as an admin override.</p>
      {confirming ? (
        <WorkspaceDialog title="Set the status directly?" titleId={`${id}-confirm`} onClose={() => setConfirming(false)} danger>
          <p className="text-v2-muted">
            <span className="font-mono font-semibold text-v2-ink">{status}</span> becomes <span className="font-mono font-semibold text-v2-ink">{to.trim().toUpperCase()}</span>. No
            print, no return, no rider record: just the status. The history says an admin did this.
          </p>
          <form action={action} className="mt-4 flex flex-wrap gap-2">
            <input type="hidden" name="orderId" value={orderId} />
            <input type="hidden" name="to" value={to} />
            <Button type="submit" variant="danger" disabled={pending} aria-busy={pending || undefined}>
              Set status
            </Button>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
            <FormNote state={state} />
          </form>
        </WorkspaceDialog>
      ) : null}
    </div>
  )
}

/** Permanent: the record and its history go. The confirm names the id. */
export function DeleteOrderButton({ orderId, externalOrderId }: { orderId: string; externalOrderId: string }) {
  return (
    <ConfirmActionButton
      action={deleteOrderV2}
      fields={{ orderId }}
      label="Delete order"
      variant="danger"
      size="sm"
      title="Delete this order?"
      description={
        <>
          <span className="font-mono font-semibold text-v2-ink">{externalOrderId}</span> and its full history will be permanently removed. This cannot be undone.
        </>
      }
      submitLabel="Delete"
    />
  )
}
