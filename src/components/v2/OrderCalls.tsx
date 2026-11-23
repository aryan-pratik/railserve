'use client'

import { useActionState, useEffect, useId, useState } from 'react'
import { Check, MessageCircle, Pencil, Trash2, X } from 'lucide-react'
import { Button, cx, v2Focus } from './ui'
import { ConfirmActionButton, FormNote, inputV2, textareaV2, type FormState } from './OrderForms'
import { formatIST } from '@/lib/format'
import type { CallNoteView } from '@/lib/callNotes'
import type { CallNoteState } from '@/app/actions/orderNotes'
import { openChatForOrderV2 } from '@/app/v2/chat/actions'
import {
  addCallNoteV2,
  cancelOrderV2,
  decideCancellationV2,
  deleteCallNoteV2,
  editCallNoteV2,
  flagRatingOrderV2,
  markDeliveredV2,
  markNotDeliveredV2,
  recordRefundV2,
  clearRefundV2,
} from '@/app/v2/orders/[id]/actions'
import { FAILURE_REASONS, REFUND_PAYERS, REFUND_REASONS } from '@/lib/orderStatus'
import type { RefundView } from '@/lib/v2/orderWorkspace'

const initial: FormState = {}

export type OutcomeFlags = {
  cancel: boolean
  deliver: boolean
  fail: boolean
}

/** One choice per line, big enough to tap: the reasons in a dialog. */
function ReasonChoices({ name, options, legend, value, required = true }: { name: string; options: Record<string, string>; legend: string; value?: string | null; required?: boolean }) {
  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1 text-xs font-semibold text-v2-ink-2">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(options).map(([code, label]) => (
          <label key={code} className="cursor-pointer">
            <input type="radio" name={name} value={code} required={required} defaultChecked={value === code} className="peer sr-only" />
            <span className="inline-flex h-9 items-center rounded-full border border-v2-line-strong px-3 text-[13.5px] font-semibold text-v2-ink-2 peer-checked:border-v2-ink peer-checked:bg-v2-ink peer-checked:text-v2-bg peer-focus-visible:ring-2 peer-focus-visible:ring-v2-brand">
              {label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/**
 * What the passenger said, as one button each. Delivered confirms; not
 * delivered and cancel need a reason on record.
 */
export function OutcomeButtons({ orderId, externalOrderId, status, can }: { orderId: string; externalOrderId: string; status: string; can: OutcomeFlags }) {
  const fields = { orderId }
  if (!can.cancel && !can.deliver && !can.fail) {
    return <p className="text-sm text-v2-muted">{status === 'CANCELLED' ? 'Already cancelled.' : 'This order can no longer be updated from here.'}</p>
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {can.deliver ? (
        <ConfirmActionButton
          action={markDeliveredV2}
          fields={fields}
          label="Delivered"
          variant="primary"
          title="Mark as delivered?"
          description="The passenger has the food. This closes the order for the kitchen and the rider."
          submitLabel="Mark delivered"
          cancelLabel="Not yet"
        />
      ) : null}
      {can.fail ? (
        <ConfirmActionButton
          action={markNotDeliveredV2}
          fields={fields}
          label="Not delivered"
          title="Not delivered: what happened?"
          description="The food did not reach the passenger. The outlet and admin see the reason."
          submitLabel="Not delivered"
          submitVariant="danger"
          extra={<ReasonChoices name="reasonCode" options={FAILURE_REASONS} legend="Reason" />}
          reason
          reasonOptional
          reasonLabel="Details (needed for Other)"
        />
      ) : null}
      {can.cancel ? (
        <ConfirmActionButton
          action={cancelOrderV2}
          fields={fields}
          label="Cancel"
          variant="danger"
          title="Cancel this order?"
          description={
            <>
              <span className="font-mono font-semibold text-v2-ink">{externalOrderId}</span> stops here: the kitchen is told immediately, and no rider can pick
              it up. An admin would have to reopen it.
            </>
          }
          submitLabel="Cancel the order"
          reason
          reasonHint="The kitchen and the admin both see this."
          quickReasons={['Passenger cancelled on the call', 'Passenger not reachable, order abandoned', 'Duplicate order: same passenger booked twice', 'Train cancelled or diverted']}
        />
      ) : null}
    </div>
  )
}

/**
 * Money paid back, and the rating-order tag. Neither changes the status:
 * the order stays delivered, not delivered or cancelled.
 */
export function RefundAndTag({ orderId, totalPaise, refund, ratingOrder }: { orderId: string; totalPaise: number | null; refund: RefundView; ratingOrder: boolean }) {
  const fields = { orderId }
  const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN')}`
  return (
    <div className="grid gap-3">
      {refund ? (
        <div className="grid gap-1 rounded-v2-md bg-v2-bad-bg px-3 py-2.5 text-sm text-v2-bad">
          <b className="text-[15px]">Refunded {rupees(refund.amountPaise)}{totalPaise && refund.amountPaise < totalPaise ? ` of ${rupees(totalPaise)}` : ''}</b>
          <span>
            {(REFUND_REASONS as Record<string, string>)[refund.reason] ?? refund.reason}
            {refund.payer ? ` · ${(REFUND_PAYERS as Record<string, string>)[refund.payer] ?? refund.payer}` : ''}
          </span>
          {refund.note ? <span className="text-v2-ink-2">&ldquo;{refund.note}&rdquo;</span> : null}
          <span className="text-xs opacity-80">{refund.by ? `${refund.by} · ` : ''}{formatIST(refund.at)}</span>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <ConfirmActionButton
          action={recordRefundV2}
          fields={fields}
          label={refund ? 'Change refund' : 'Record refund'}
          title={refund ? 'Change the refund' : 'Record a refund'}
          description="Money paid back to the passenger. The order keeps its status."
          submitLabel="Save refund"
          submitVariant="primary"
          extra={
            <div className="grid gap-3">
              <label className="grid gap-1.5 text-xs font-semibold text-v2-ink-2">
                Amount paid back (₹)
                <input
                  name="amount"
                  inputMode="decimal"
                  required
                  defaultValue={refund ? refund.amountPaise / 100 : totalPaise ? totalPaise / 100 : ''}
                  className={cx(inputV2, 'font-mono')}
                />
              </label>
              <ReasonChoices name="reasonCode" options={REFUND_REASONS} legend="Why" value={refund?.reason} />
              <ReasonChoices name="payer" options={REFUND_PAYERS} legend="Who paid it back" value={refund?.payer} required={false} />
              <label className="grid gap-1.5 text-xs font-semibold text-v2-ink-2">
                Note (optional)
                <input name="note" maxLength={300} defaultValue={refund?.note ?? ''} className={inputV2} />
              </label>
            </div>
          }
        />
        {refund ? (
          <ConfirmActionButton
            action={clearRefundV2}
            fields={fields}
            label="Remove refund"
            variant="ghost"
            title="Remove this refund?"
            description="Only if it was recorded by mistake. The history keeps a note of it."
            submitLabel="Remove refund"
            submitVariant="danger"
          />
        ) : null}
        <ConfirmActionButton
          action={flagRatingOrderV2}
          fields={{ orderId, on: ratingOrder ? '0' : '1' }}
          label={ratingOrder ? 'Not a rating order' : 'Rating order'}
          variant="ghost"
          title={ratingOrder ? 'Remove the rating-order tag?' : 'Tag as a rating order?'}
          description={
            ratingOrder
              ? 'It counts as a real order again in totals and reports.'
              : 'A decoy placed only to get an app-store rating. It keeps its status but is left out of totals and reports.'
          }
          submitLabel={ratingOrder ? 'Remove tag' : 'Tag it'}
          submitVariant="primary"
          cancelLabel="Keep it as is"
        />
      </div>
    </div>
  )
}

/** Accept (which cancels) or refuse a store manager's request. */
export function DecideCancelRequest({ orderId, externalOrderId }: { orderId: string; externalOrderId: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ConfirmActionButton
        action={decideCancellationV2}
        fields={{ orderId, decision: 'approve' }}
        label="Accept and cancel"
        variant="danger"
        title="Cancel this order?"
        description={
          <>
            Accepting cancels <span className="font-mono font-semibold text-v2-ink">{externalOrderId}</span> with the kitchen&apos;s reason on the record. The kitchen is told at once.
          </>
        }
        submitLabel="Accept and cancel"
      />
      <ConfirmActionButton
        action={decideCancellationV2}
        fields={{ orderId, decision: 'refuse' }}
        label="Refuse"
        title="Refuse the request?"
        description="The order keeps going. The store manager sees your note."
        submitLabel="Refuse"
        submitVariant="primary"
        extra={
          <label className="grid gap-1.5 text-xs font-semibold text-v2-ink-2">
            Note for the store manager (optional)
            <input name="note" maxLength={500} placeholder="e.g. Passenger still wants it" className={inputV2} />
          </label>
        }
      />
    </div>
  )
}

/** Opens the passenger's WhatsApp thread, aimed at this order. */
export function OpenChatButton({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState(openChatForOrderV2, {})
  return (
    <form action={action} className="inline-flex flex-wrap items-center gap-2">
      <input type="hidden" name="orderId" value={orderId} />
      <Button type="submit" size="sm" disabled={pending} aria-busy={pending || undefined}>
        <MessageCircle size={15} aria-hidden />
        WhatsApp
      </Button>
      <FormNote state={state} />
    </form>
  )
}

/* ── call log ──────────────────────────────────────────────────────────── */

/**
 * What was said on the phone, newest first, with the box to add the next
 * line. A note's author (or an admin) can correct or delete it in place.
 */
export function CallLog({ orderId, notes, canWrite }: { orderId: string; notes: CallNoteView[]; canWrite: boolean }) {
  return (
    <div className="grid gap-3">
      {notes.length === 0 ? (
        <p className="text-sm text-v2-muted">No call notes yet. What the passenger says on the phone goes here.</p>
      ) : (
        <ol className="grid max-h-72 gap-0.5 overflow-y-auto [overscroll-behavior:contain]">
          {[...notes].reverse().map((n) => (
            <CallNoteRow key={n.id} orderId={orderId} note={n} />
          ))}
        </ol>
      )}
      {canWrite ? <AddCallNote orderId={orderId} /> : null}
    </div>
  )
}

function CallNoteRow({ orderId, note }: { orderId: string; note: CallNoteView }) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <li className="py-1">
        <EditNote orderId={orderId} note={note} onDone={() => setEditing(false)} />
      </li>
    )
  }
  return (
    <li className="group grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 rounded-v2-sm px-1.5 py-1.5 hover:bg-v2-surface-2">
      <div className="min-w-0">
        <p className="whitespace-pre-wrap break-words text-sm">{note.text}</p>
        <p className="text-xs text-v2-faint">
          <span className="font-mono tabular-nums">{formatIST(note.at)}</span>
          {note.author ? ` · ${note.author}` : ''}
          {note.editedAt ? ' · edited' : ''}
        </p>
      </div>
      {note.canManage ? (
        <span className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={`Edit the note "${note.text}"`}
            className={cx('grid h-7 w-7 place-items-center rounded-full text-v2-faint hover:bg-v2-surface hover:text-v2-ink', v2Focus)}
          >
            <Pencil size={13} aria-hidden />
          </button>
          <DeleteNote orderId={orderId} note={note} />
        </span>
      ) : null}
    </li>
  )
}

function AddCallNote({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState<CallNoteState, FormData>(addCallNoteV2, initial)
  const id = useId()
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="orderId" value={orderId} />
      <label htmlFor={id} className="sr-only">
        Add a call note
      </label>
      {/* Keyed on the save token so a saved note leaves an empty box behind. */}
      <textarea key={state.savedAt ?? 'new'} id={id} name="text" rows={2} maxLength={500} placeholder="What did the passenger say?" className={textareaV2} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" variant="primary" disabled={pending} aria-busy={pending || undefined}>
          Add note
        </Button>
        <FormNote state={state} />
      </div>
    </form>
  )
}

function EditNote({ orderId, note, onDone }: { orderId: string; note: CallNoteView; onDone: () => void }) {
  const [state, action, pending] = useActionState<CallNoteState, FormData>(editCallNoteV2, initial)
  useEffect(() => {
    if (state.savedAt) onDone()
    // Fires on the action's own token, not on the callback identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.savedAt])
  return (
    <form action={action} className="flex items-center gap-1.5">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="noteId" value={note.id} />
      <input
        name="text"
        defaultValue={note.text}
        autoFocus
        maxLength={500}
        aria-label="Note"
        className={cx(inputV2, 'h-8 min-w-0 flex-1')}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onDone()
        }}
      />
      <Button type="submit" size="sm" variant="primary" disabled={pending} aria-label="Save note">
        <Check size={14} aria-hidden />
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onDone} aria-label="Cancel">
        <X size={14} aria-hidden />
      </Button>
      <FormNote state={state} />
    </form>
  )
}

function DeleteNote({ orderId, note }: { orderId: string; note: CallNoteView }) {
  const [state, action, pending] = useActionState<CallNoteState, FormData>(deleteCallNoteV2, initial)
  const [confirming, setConfirming] = useState(false)
  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label={`Delete the note "${note.text}"`}
        className={cx('grid h-7 w-7 place-items-center rounded-full text-v2-faint hover:bg-v2-bad-bg hover:text-v2-bad', v2Focus)}
      >
        <Trash2 size={13} aria-hidden />
      </button>
    )
  }
  return (
    <form action={action} className="flex items-center gap-1">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="noteId" value={note.id} />
      <button type="submit" disabled={pending} className={cx('rounded-full px-2 py-0.5 text-[11px] font-bold text-v2-bad hover:bg-v2-bad-bg disabled:opacity-50', v2Focus)}>
        Delete
      </button>
      <button type="button" onClick={() => setConfirming(false)} className={cx('rounded-full px-2 py-0.5 text-[11px] font-semibold text-v2-muted hover:bg-v2-surface', v2Focus)}>
        Keep
      </button>
      <FormNote state={state} />
    </form>
  )
}
