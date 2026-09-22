'use client'

import { useActionState, useCallback, useState } from 'react'
import { Button, FormNote } from '@/components/ui'
import { Modal } from '@/components/Modal'
import { flagRatingOrder, type CallActionState } from './actions'

const initial: CallActionState = {}

/**
 * Flags a decoy order run purely for an app-store rating. No reason field —
 * see the doc comment on `flagRatingOrder` in actions.ts — just a confirm
 * step, since this works even on an already-terminal order and a mis-tap
 * there is otherwise silent and hard to notice.
 */
export function RatingOrderButton({ orderId }: { orderId: string }) {
  const [requested, setRequested] = useState(false)
  const [state, action, pending] = useActionState(flagRatingOrder, initial)

  const open = requested && !state.ok
  const close = useCallback(() => setRequested(false), [])

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setRequested(true)}>
        Rating order
      </Button>

      <FormNote state={state} />

      {open ? (
        <Modal title="Mark as a rating order?" titleId="rating-order-modal" onClose={close}>
          <form action={action} className="space-y-4 p-4">
            <input type="hidden" name="orderId" value={orderId} />

            <p className="text-sm text-muted text-pretty">
              This flags the order as a decoy run for app-store ratings, not a real order. It
              drops off the live board and out of revenue totals. Only an admin can undo this.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="primary" pending={pending}>
                Mark as rating order
              </Button>
              <Button type="button" variant="secondary" onClick={close}>
                Keep it as is
              </Button>
              <FormNote state={state} />
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  )
}
