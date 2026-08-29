'use client'

import { useActionState, useState } from 'react'
import { ProofPhotoField } from '@/components/ProofPhotoField'
import {
  deliverOrderAction, dispatchRunAction, failOrderAction, requestProofUpload,
  takeOrderAction, type AgentActionState,
} from './actions'
import { Button, inputClass } from '@/components/ui'

const initial: AgentActionState = {}

function Note({ state }: { state: AgentActionState }) {
  if (state.error) {
    return <p role="alert" className="mt-2 text-sm font-medium text-red-600">{state.error}</p>
  }
  if (state.ok) {
    return <p className="mt-2 text-sm font-medium text-emerald-700">{state.ok}</p>
  }
  return null
}

export function DispatchRunButton({ runKey, readyCount }: { runKey: string; readyCount: number }) {
  const [state, action, pending] = useActionState(dispatchRunAction, initial)

  return (
    <form action={action}>
      <input type="hidden" name="runKey" value={runKey} />
      <Button type="submit" size="lg" disabled={pending || readyCount === 0} className="w-full font-bold">
        {pending
          ? 'Dispatching…'
          : readyCount === 0
            ? 'Nothing ready yet'
            : `Mark run dispatched (${readyCount})`}
      </Button>
      <Note state={state} />
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

      <div>
        <label htmlFor="receivedBy" className="mb-1 block text-sm font-medium text-muted">
          Received by {photoEnabled ? <span className="text-faint">(optional with a photo)</span> : null}
        </label>
        <input
          id="receivedBy" name="receivedBy" required={!photoEnabled} autoComplete="off"
          placeholder="Name of the person who took it"
          className={`${inputClass} py-3 text-base`}
        />
      </div>

      {isCod ? (
        <div>
          <label htmlFor="amountCollected" className="mb-1 block text-sm font-medium text-muted">
            Cash collected (₹)
          </label>
          <input
            id="amountCollected" name="amountCollected" inputMode="decimal"
            defaultValue={amountRupees}
            className={`${inputClass} py-3 text-base`}
          />
        </div>
      ) : null}

      <button
        type="submit" disabled={pending}
        className="w-full rounded-xl bg-emerald-600 px-4 py-4 text-base font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
      >
        {pending ? 'Saving…' : 'Mark delivered'}
      </button>
      <Note state={state} />
    </form>
  )
}

export function FailForm({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState(failOrderAction, initial)
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <div className="px-4 pb-4">
        <button
          type="button" onClick={() => setOpen(true)}
          className="w-full rounded-xl border border-red-300 px-4 py-3 text-sm font-semibold text-red-700 transition hover:bg-red-50"
        >
          Could not deliver
        </button>
      </div>
    )
  }

  return (
    <form action={action} className="space-y-3 border-t border-line p-4">
      <input type="hidden" name="orderId" value={orderId} />
      <div>
        <label htmlFor="failureReason" className="mb-1 block text-sm font-medium text-muted">
          What happened?
        </label>
        <textarea
          id="failureReason" name="failureReason" required rows={3}
          placeholder="Passenger not at seat, train did not halt, coach changed…"
          className={`${inputClass} text-base`}
        />
      </div>
      <div className="flex gap-2">
        <button
          type="submit" disabled={pending}
          className="flex-1 rounded-xl bg-red-600 px-4 py-3 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Mark failed'}
        </button>
        <button
          type="button" onClick={() => setOpen(false)}
          className="rounded-xl border border-line-strong px-4 py-3 text-sm font-medium text-muted hover:bg-sunken"
        >
          Cancel
        </button>
      </div>
      <Note state={state} />
    </form>
  )
}

/**
 * "I'm taking this" — one order, straight off the shelf.
 *
 * Full width and thumb-sized because it is pressed on a platform, one-handed,
 * usually while holding a bag.
 */
export function TakeOrderButton({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState(takeOrderAction, initial)
  return (
    <form action={action} className="p-4">
      <input type="hidden" name="orderId" value={orderId} />
      <Button type="submit" size="lg" disabled={pending} className="w-full font-bold">
        {pending ? 'Saving…' : "I'm taking this"}
      </Button>
      <Note state={state} />
    </form>
  )
}
