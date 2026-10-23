'use client'

import { useActionState, useState } from 'react'
import { Button, FormNote } from '@/components/ui'
import { collectRiderCashAction, type CollectCashState } from './cashActions'

const initial: CollectCashState = {}

/**
 * Two taps, not one: the second is the manager saying the notes are in their
 * hand. A single misplaced click would otherwise zero a rider's wallet for
 * money nobody counted.
 */
export function CollectCashButton({
  riderId,
  riderName,
  orderIds,
  amountLabel,
}: {
  riderId: string
  riderName: string
  orderIds: string[]
  amountLabel: string
}) {
  const [state, action, pending] = useActionState(collectRiderCashAction, initial)
  const [confirming, setConfirming] = useState(false)

  return (
    <form
      action={(fd) => {
        setConfirming(false)
        action(fd)
      }}
      className="flex flex-wrap items-center justify-end gap-2"
    >
      <input type="hidden" name="riderId" value={riderId} />
      <input type="hidden" name="orderIds" value={orderIds.join(',')} />
      {confirming ? (
        <>
          <span className="text-xs text-muted">Received {amountLabel}?</span>
          <Button type="submit" size="sm" variant="go" pending={pending} aria-label={`Confirm ${amountLabel} received from ${riderName}`}>
            Yes, received
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          pending={pending}
          onClick={() => setConfirming(true)}
          aria-label={`Collect ${amountLabel} from ${riderName}`}
        >
          Collect {amountLabel}
        </Button>
      )}
      <FormNote state={state} className="w-full text-right text-xs" />
    </form>
  )
}
