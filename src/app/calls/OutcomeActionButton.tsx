'use client'

import { useActionState, useCallback, useRef, useState } from 'react'
import { Button, Field, FormNote, focusRing, textareaClass } from '@/components/ui'
import { Modal } from '@/components/Modal'
import type { CallActionState } from './actions'

const initial: CallActionState = {}

type OutcomeAction = (prev: CallActionState, formData: FormData) => Promise<CallActionState>

/**
 * The shared shape behind Misdelivery / Missed delivery / Refunded: a
 * support-call outcome that needs a reason on record, same as
 * CancelOrderButton but without the danger tone or the "this stops the
 * kitchen" copy, since these can be recorded well after the fact. Kept as one
 * component rather than three near-identical files, parameterized by the
 * copy each outcome needs.
 */
export function OutcomeActionButton({
  orderId,
  action,
  buttonLabel,
  modalTitle,
  description,
  quickReasons,
}: {
  orderId: string
  action: OutcomeAction
  buttonLabel: string
  modalTitle: string
  description: string
  quickReasons: readonly string[]
}) {
  const [requested, setRequested] = useState(false)
  const [state, formAction, pending] = useActionState(action, initial)

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
        {buttonLabel}
      </Button>

      <FormNote state={state} />

      {open ? (
        <Modal title={modalTitle} titleId="outcome-action-modal" onClose={close}>
          <form action={formAction} className="space-y-4 p-4">
            <input type="hidden" name="orderId" value={orderId} />

            <p className="text-sm text-muted text-pretty">{description}</p>

            <div className="flex flex-wrap gap-1.5">
              {quickReasons.map((r) => (
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

            <Field label="Why" htmlFor="reason" hint="The outlet and admin both see this.">
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
              <Button type="submit" variant="primary" pending={pending}>
                {buttonLabel}
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
