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
  markMisdeliveryV2,
  markMissedDeliveryV2,
  markNotDeliveredV2,
  markRefundedV2,
} from '@/app/v2/orders/[id]/actions'

const initial: FormState = {}

export type OutcomeFlags = {
  cancel: boolean
  deliver: boolean
  fail: boolean
  misdeliver: boolean
  missDeliver: boolean
  refund: boolean
  rating: boolean
}

/**
 * What the passenger said, as one button each. Delivered confirms; every
 * other outcome needs a reason on record, with the usual ones one tap away.
 */
export function OutcomeButtons({ orderId, externalOrderId, status, can }: { orderId: string; externalOrderId: string; status: string; can: OutcomeFlags }) {
  const fields = { orderId }
  const none = !can.cancel && !can.deliver && !can.fail && !can.misdeliver && !can.missDeliver && !can.refund && !can.rating
  if (none) {
    return (
      <p className="text-sm text-v2-muted">
        {status === 'CANCELLED' ? 'Already cancelled.' : status === 'RATING_ORDER' ? 'Already marked as a rating order.' : 'This order can no longer be updated from here.'}
      </p>
    )
  }
  return (
    <div className="grid gap-3">
      {can.deliver || can.fail ? (
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
              title="Mark as not delivered?"
              description="The food did not reach the passenger. This closes the order as not delivered, with your reason, for the outlet and admin."
              submitLabel="Not delivered"
              submitVariant="danger"
              reason
              reasonHint="The outlet and admin both see this."
              quickReasons={['Passenger not reachable at the seat', 'Train left before the rider got there', 'Passenger refused the food']}
            />
          ) : null}
        </div>
      ) : null}
      {can.cancel || can.misdeliver || can.missDeliver || can.refund ? (
        <div className="flex flex-wrap items-center gap-2">
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
          {can.misdeliver ? (
            <ConfirmActionButton
              action={markMisdeliveryV2}
              fields={fields}
              label="Misdelivery"
              title="Mark as misdelivered?"
              description="The food reached the wrong seat or passenger. This is recorded against the order for the outlet and admin."
              submitLabel="Record misdelivery"
              submitVariant="primary"
              reason
              reasonHint="The outlet and admin both see this."
              quickReasons={['Delivered to the wrong seat', 'Delivered to the wrong passenger', 'Wrong order handed to this passenger']}
            />
          ) : null}
          {can.missDeliver ? (
            <ConfirmActionButton
              action={markMissedDeliveryV2}
              fields={fields}
              label="Missed delivery"
              title="Mark as a missed delivery?"
              description="The rider could not reach the passenger or seat in time. This is recorded against the order for the outlet and admin."
              submitLabel="Record missed delivery"
              submitVariant="primary"
              reason
              reasonHint="The outlet and admin both see this."
              quickReasons={['Passenger not at seat, unreachable', 'Train left before delivery', 'Rider could not locate the seat']}
            />
          ) : null}
          {can.refund ? (
            <ConfirmActionButton
              action={markRefundedV2}
              fields={fields}
              label="Refunded"
              title="Mark as refunded?"
              description="The passenger is being refunded for this order. This is recorded against the order for the outlet and admin."
              submitLabel="Record refund"
              submitVariant="primary"
              reason
              reasonHint="The outlet and admin both see this."
              quickReasons={['Passenger requested a refund on the call', 'Order was refunded after a complaint']}
            />
          ) : null}
        </div>
      ) : null}
      {can.rating ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-v2-line pt-3">
          <ConfirmActionButton
            action={flagRatingOrderV2}
            fields={fields}
            label="Rating order"
            size="sm"
            title="Mark as a rating order?"
            description="This flags the order as a decoy run for app-store ratings, not a real order. It drops off the live board and out of revenue totals. Only an admin can undo this."
            submitLabel="Mark as rating order"
            submitVariant="primary"
            cancelLabel="Keep it as is"
          />
        </div>
      ) : null}
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
