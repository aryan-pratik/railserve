'use client'

import { useActionState, useCallback, useRef, useState } from 'react'
import Link from 'next/link'
import { Button, Card, CardHeader, Field, FormNote, focusRing, inputClass, textareaClass } from '@/components/ui'
import { Modal } from '@/components/Modal'
import { formatIST } from '@/lib/format'
import {
  decideCancellationAction,
  requestCancellationAction,
  type CancelRequestState,
} from '@/app/actions/cancelRequests'

const initial: CancelRequestState = {}

/** What the kitchen most often has to say. Prefills, not a fixed list. */
const QUICK_REASONS = [
  'Item finished, cannot prepare',
  'Kitchen cannot make it in time for the train',
  'Duplicate order',
  'Train cancelled or diverted',
]

/**
 * The store manager's "please cancel this". Same shape as the telecaller's
 * CancelOrderButton, but it asks rather than cancels: nothing stops until a
 * telecaller or an admin accepts.
 */
export function RequestCancelButton({
  orderId,
  externalOrderId,
}: {
  orderId: string
  externalOrderId: string
}) {
  const [requested, setRequested] = useState(false)
  const [state, action, pending] = useActionState(requestCancellationAction, initial)
  const reasonRef = useRef<HTMLTextAreaElement>(null)

  const open = requested && !state.ok
  const close = useCallback(() => setRequested(false), [])

  function prefill(reason: string) {
    const field = reasonRef.current
    if (!field) return
    field.value = reason
    field.focus()
    field.setSelectionRange(reason.length, reason.length)
  }

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setRequested(true)}>
        Request cancel
      </Button>

      <FormNote state={state} />

      {open ? (
        <Modal title="Ask to cancel this order?" titleId="request-cancel-modal" onClose={close}>
          <form action={action} className="space-y-4 p-4">
            <input type="hidden" name="orderId" value={orderId} />

            <p className="text-sm text-muted text-pretty">
              <span className="font-mono font-semibold text-ink">{externalOrderId}</span> is not
              cancelled yet: the call desk and the admin see your request and accept or refuse it.
              Keep the order going until they do.
            </p>

            <div className="flex flex-wrap gap-1.5">
              {QUICK_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => prefill(r)}
                  className={`rounded-full border border-line-strong bg-surface px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:bg-sunken hover:text-ink ${focusRing}`}
                >
                  {r}
                </button>
              ))}
            </div>

            <Field label="Why" htmlFor="cancel-request-reason" hint="Required. The call desk and the admin see this.">
              <textarea
                ref={reasonRef}
                id="cancel-request-reason"
                name="reason"
                required
                minLength={3}
                rows={3}
                maxLength={500}
                placeholder="Why can this order not go out?"
                className={textareaClass}
              />
            </Field>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="danger" pending={pending}>
                Send request
              </Button>
              <Button type="button" variant="secondary" onClick={close}>
                Keep it
              </Button>
              <FormNote state={state} />
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  )
}

export type CancelRequestInfo = {
  status: 'PENDING' | 'APPROVED' | 'REFUSED'
  reason: string
  requestedBy: string
  requestedAt: string
  decidedBy: string | null
  decidedAt: string | null
  decisionNote: string | null
}

/**
 * The request as it stands, on an order's own page.
 *
 * `canDecide` is true for a telecaller or an admin, who get Accept and Refuse
 * while it is pending. Everyone else reads it.
 */
export function CancelRequestCard({
  orderId,
  request,
  canDecide,
}: {
  orderId: string
  request: CancelRequestInfo
  canDecide: boolean
}) {
  const pending = request.status === 'PENDING'
  const tone = pending
    ? 'bg-amber-50 text-amber-900 ring-amber-200'
    : request.status === 'APPROVED'
      ? 'bg-red-50 text-red-900 ring-red-200'
      : 'bg-sunken text-ink ring-line'

  return (
    <Card>
      <CardHeader
        title={
          pending
            ? 'Cancellation requested'
            : request.status === 'APPROVED'
              ? 'Cancellation request accepted'
              : 'Cancellation request refused'
        }
      />
      <div className="space-y-3 p-4">
        <div className={`rounded-lg px-4 py-3 text-sm ring-1 ring-inset ${tone}`}>
          <p className="whitespace-pre-wrap font-medium">&ldquo;{request.reason}&rdquo;</p>
          <p className="mt-1 text-xs opacity-80">
            {request.requestedBy} · {formatIST(request.requestedAt)}
          </p>
        </div>

        {!pending && request.decidedBy ? (
          <p className="text-sm text-muted">
            {request.status === 'APPROVED' ? 'Accepted' : 'Refused'} by {request.decidedBy}
            {request.decidedAt ? ` · ${formatIST(request.decidedAt)}` : ''}
            {request.decisionNote ? <>: &ldquo;{request.decisionNote}&rdquo;</> : null}
          </p>
        ) : null}

        {pending && canDecide ? <DecideForm orderId={orderId} /> : null}
        {pending && !canDecide ? (
          <p className="text-sm text-muted">Waiting for the call desk or an admin to answer.</p>
        ) : null}
      </div>
    </Card>
  )
}

function DecideForm({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState(decideCancellationAction, initial)
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="orderId" value={orderId} />
      <Field label="Note if refusing" htmlFor={`cancel-decision-note-${orderId}`} hint="Optional. The store manager sees this.">
        <input
          id={`cancel-decision-note-${orderId}`}
          name="note"
          maxLength={500}
          placeholder="e.g. Passenger still wants it"
          className={inputClass}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" name="decision" value="approve" variant="danger" pending={pending}>
          Accept and cancel
        </Button>
        <Button type="submit" name="decision" value="refuse" variant="secondary" disabled={pending}>
          Refuse
        </Button>
        <FormNote state={state} />
      </div>
    </form>
  )
}

export type PendingCancelRequestRow = {
  id: string
  externalOrderId: string
  trainNo: string | null
  rawSeat: string | null
  reason: string
  requestedBy: string
  requestedAt: string
}

/**
 * The queue of requests waiting for an answer, at the top of the call list and
 * the admin board. Renders nothing when there are none. Each row links to the
 * order, where the request can be accepted or refused with the order in view.
 */
export function PendingCancelRequests({
  rows,
  orderBasePath,
}: {
  rows: PendingCancelRequestRow[]
  /** e.g. `/calls/orders`; the row links to `${orderBasePath}/${id}`. */
  orderBasePath: string
}) {
  if (rows.length === 0) return null
  return (
    <Card>
      <CardHeader title={`Cancellation requests waiting (${rows.length})`} />
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
            <Link
              href={`${orderBasePath}/${r.id}`}
              className="font-mono font-semibold text-accent underline-offset-2 hover:underline"
            >
              {r.externalOrderId}
            </Link>
            {r.trainNo ? <span className="font-mono tabular-nums text-muted">{r.trainNo}</span> : null}
            {r.rawSeat ? <span className="font-mono text-muted">{r.rawSeat}</span> : null}
            <span className="min-w-0 flex-1 truncate text-ink">&ldquo;{r.reason}&rdquo;</span>
            <span className="text-xs text-faint">
              {r.requestedBy} · {formatIST(r.requestedAt)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
