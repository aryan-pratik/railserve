'use client'

import { useActionState, useCallback, useRef, useState } from 'react'
import { Button, Field, FormNote, focusRing, textareaClass } from '@/components/ui'
import { Modal } from '@/components/Modal'
import { cancelOrder, type CallActionState } from './actions'

const initial: CallActionState = {}

/**
 * The four sentences a telecaller actually writes, as one tap each.
 *
 * They are prefills, not a fixed list: the textarea stays editable, because
 * the reason that matters most is usually the one nobody anticipated. Without
 * them the honest outcome is a reason field that reads "cancel" all day.
 */
const QUICK_REASONS = [
  'Passenger cancelled on the call',
  'Passenger not reachable, order abandoned',
  'Duplicate order: same passenger booked twice',
  'Train cancelled or diverted',
]

export function CancelOrderButton({
  orderId,
  externalOrderId,
}: {
  orderId: string
  externalOrderId: string
}) {
  const [requested, setRequested] = useState(false)
  const [state, action, pending] = useActionState(cancelOrder, initial)

  // Uncontrolled, like every other form in this app. A controlled value here
  // re-rendered this component on every keystroke, and that is what exposed
  // the focus bug in Modal — but it was never the right shape anyway: the
  // field is read once, on submit, by name.
  const reasonRef = useRef<HTMLTextAreaElement>(null)

  // Derived, not closed from an effect: once the action has succeeded the
  // modal has nothing left to show, and saying so in the render is one fewer
  // pass than setting state after the fact. The page behind has already been
  // revalidated by then, so the button itself is on its way out too.
  const open = requested && !state.ok
  const close = useCallback(() => setRequested(false), [])

  /** A tap fills the box and hands it straight back, caret at the end. */
  function prefill(reason: string) {
    const field = reasonRef.current
    if (!field) return
    field.value = reason
    field.focus()
    field.setSelectionRange(reason.length, reason.length)
  }

  return (
    <>
      <Button type="button" variant="danger" onClick={() => setRequested(true)}>
        Cancel
      </Button>

      {/* Reported on the page too, so a failure is not lost with the modal. */}
      <FormNote state={state} />

      {open ? (
        <Modal
          title="Cancel this order?"
          titleId="cancel-order-modal"
          onClose={close}
        >
          <form action={action} className="space-y-4 p-4">
            <input type="hidden" name="orderId" value={orderId} />

            <p className="text-sm text-muted text-pretty">
              <span className="font-mono font-semibold text-ink">{externalOrderId}</span> stops
              here: the kitchen is told immediately, and no rider can pick it up. This cannot be
              undone from your screen: an admin would have to reopen it.
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

            <Field label="Why" htmlFor="reason" hint="The kitchen and the admin both see this.">
              <textarea
                ref={reasonRef}
                id="reason"
                name="reason"
                required
                rows={3}
                maxLength={500}
                placeholder="What did the passenger say?"
                className={textareaClass}
              />
            </Field>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="danger" pending={pending}>
                Cancel the order
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
