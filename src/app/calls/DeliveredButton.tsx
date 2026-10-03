'use client'

import { useActionState, useCallback, useState } from 'react'
import { Button, FormNote } from '@/components/ui'
import { Modal } from '@/components/Modal'
import { markDelivered, type CallActionState } from './actions'

const initial: CallActionState = {}

/** Delivered, with a confirm step: it ends the order, and a mis-tap is easy. */
export function DeliveredButton({ orderId }: { orderId: string }) {
  const [requested, setRequested] = useState(false)
  const [state, action, pending] = useActionState(markDelivered, initial)

  const open = requested && !state.ok
  const close = useCallback(() => setRequested(false), [])

  return (
    <>
      <Button type="button" variant="primary" onClick={() => setRequested(true)}>
        Delivered
      </Button>

      <FormNote state={state} />

      {open ? (
        <Modal title="Mark as delivered?" titleId="delivered-modal" onClose={close}>
          <form action={action} className="space-y-4 p-4">
            <input type="hidden" name="orderId" value={orderId} />

            <p className="text-sm text-muted text-pretty">
              The passenger has the food. This closes the order for the kitchen and the rider.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="primary" pending={pending}>
                Mark delivered
              </Button>
              <Button type="button" variant="secondary" onClick={close}>
                Not yet
              </Button>
              <FormNote state={state} />
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  )
}
