'use client'

import { useActionState, useCallback, useRef, useState } from 'react'
import type { CallActionState } from '@/app/calls/actions'
import { cancelFromCallBoard } from '@/app/v2/calls/actions'
import { CallsDialog, FormLine, v2Input } from './CallsDialog'
import { Button, Mono, cx, v2Focus } from './ui'

const initial: CallActionState = {}

/** Prefills, not a fixed list: the textarea stays editable. */
const QUICK_REASONS = [
  'Passenger cancelled on the call',
  'Passenger not reachable, order abandoned',
  'Duplicate order: same passenger booked twice',
  'Train cancelled or diverted',
]

/** Outlined red, and always a confirm that carries the reason. */
export function CallsCancelButton({ orderId, externalOrderId }: { orderId: string; externalOrderId: string }) {
  const [requested, setRequested] = useState(false)
  const [state, action, pending] = useActionState(cancelFromCallBoard, initial)
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  // Derived: once the action succeeded the dialog has nothing left to show.
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
      <Button type="button" variant="danger" size="sm" onClick={() => setRequested(true)}>
        Cancel
      </Button>
      {state.error && !open ? <FormLine state={state} /> : null}

      {open ? (
        <CallsDialog title="Cancel this order?" titleId={`cancel-${orderId}`} onClose={close}>
          <form action={action} className="grid gap-4">
            <input type="hidden" name="orderId" value={orderId} />
            <p className="text-sm text-v2-muted">
              <Mono className="font-semibold text-v2-ink">{externalOrderId}</Mono> stops here: the kitchen is told at once and no rider can pick it up. Only an
              admin can reopen it.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => prefill(r)}
                  className={cx('rounded-full border border-v2-line bg-v2-surface px-2.5 py-1 text-xs font-medium text-v2-ink-2 hover:bg-v2-surface-2', v2Focus)}
                >
                  {r}
                </button>
              ))}
            </div>
            <label className="grid gap-1.5 text-sm">
              <span className="font-semibold">Why</span>
              <textarea ref={reasonRef} name="reason" required rows={3} maxLength={500} placeholder="What did the passenger say?" className={v2Input} />
              <span className="text-xs text-v2-muted">The kitchen and the admin both see this.</span>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" variant="danger" disabled={pending}>
                {pending ? 'Cancelling…' : 'Cancel the order'}
              </Button>
              <Button type="button" variant="ghost" onClick={close}>
                Keep it
              </Button>
              <FormLine state={state} />
            </div>
          </form>
        </CallsDialog>
      ) : null}
    </>
  )
}
