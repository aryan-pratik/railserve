'use client'

import { useActionState, useState } from 'react'
import { ProofPhotoField } from '@/components/ProofPhotoField'
import {
  deliverOrderAction, dispatchRunAction, failOrderAction, requestProofUpload,
  takeOrderAction, type AgentActionState,
} from './actions'
import { Button, Field, FormNote, inputClass, textareaClass } from '@/components/ui'

const initial: AgentActionState = {}

/** Thumb-sized inputs: every field here is filled in one-handed on a platform. */
const bigInput = `${inputClass} h-12 text-base`

export function DispatchRunButton({ runKey, readyCount }: { runKey: string; readyCount: number }) {
  const [state, action, pending] = useActionState(dispatchRunAction, initial)

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="runKey" value={runKey} />
      <Button type="submit" size="lg" pending={pending} disabled={readyCount === 0} className="w-full font-bold">
        {readyCount === 0 ? 'Nothing ready yet' : `Mark run dispatched (${readyCount})`}
      </Button>
      <FormNote state={state} className="block" />
    </form>
  )
}

export function DeliverForm({
  orderId, isCod, amountRupees, photoEnabled,
}: {
  orderId: string; isCod: boolean; amountRupees: string; photoEnabled: boolean
}) {
  const [state, action, pending] = useActionState(deliverOrderAction, initial)

  return (
    <form action={action} className="space-y-3 p-4">
      <input type="hidden" name="orderId" value={orderId} />

      {/* Photo first: it is the stronger evidence and the thing we want the
          rider to reach for. Only rendered when a bucket is configured. */}
      {photoEnabled ? (
        <ProofPhotoField orderId={orderId} requestUpload={requestProofUpload} />
      ) : null}

      <Field label={photoEnabled ? 'Received by (optional with a photo)' : 'Received by'} htmlFor="receivedBy">
        <input
          id="receivedBy" name="receivedBy" required={!photoEnabled} autoComplete="off"
          placeholder="Name of the person who took it"
          className={bigInput}
        />
      </Field>

      {isCod ? (
        <Field label="Cash collected (₹)" htmlFor="amountCollected">
          <input
            id="amountCollected" name="amountCollected" inputMode="decimal" autoComplete="off"
            defaultValue={amountRupees}
            className={`${bigInput} tabular-nums`}
          />
        </Field>
      ) : null}

      <Button type="submit" size="lg" variant="go" pending={pending} className="w-full font-bold">
        Mark delivered
      </Button>
      <FormNote state={state} className="block" />
    </form>
  )
}

export function FailForm({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState(failOrderAction, initial)
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <div className="px-4 pb-4">
        <Button type="button" size="lg" variant="danger" onClick={() => setOpen(true)} className="w-full">
          Could not deliver
        </Button>
      </div>
    )
  }

  return (
    <form action={action} className="space-y-3 border-t border-line p-4">
      <input type="hidden" name="orderId" value={orderId} />
      <Field label="What happened?" htmlFor="failureReason">
        <textarea
          id="failureReason" name="failureReason" required rows={3} autoFocus
          placeholder="Passenger not at seat, train did not halt, coach changed"
          className={`${textareaClass} text-base`}
        />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" size="lg" pending={pending} className="flex-1 bg-red-600 hover:bg-red-700">
          Mark failed
        </Button>
        <Button type="button" size="lg" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <FormNote state={state} className="block" />
    </form>
  )
}

/**
 * "I'm taking this": one order, straight off the shelf.
 *
 * Full width and thumb-sized because it is pressed on a platform, one-handed,
 * usually while holding a bag.
 */
export function TakeOrderButton({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState(takeOrderAction, initial)
  return (
    <form action={action} className="space-y-2 p-4">
      <input type="hidden" name="orderId" value={orderId} />
      <Button type="submit" size="lg" pending={pending} className="w-full font-bold">
        I&apos;m taking this
      </Button>
      <FormNote state={state} className="block" />
    </form>
  )
}
