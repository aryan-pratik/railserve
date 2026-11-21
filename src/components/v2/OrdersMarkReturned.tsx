'use client'

import { useActionState, useState } from 'react'
import { markReturnedV2 } from '@/app/v2/orders/actions'
import type { ReturnActionState } from '@/app/actions/returns'
import { Button, cx, v2Focus } from './ui'

const INITIAL: ReturnActionState = {}

/**
 * "The bag is back on the counter." Two taps, like collecting cash: the
 * second is the person saying the food is in their hands, so one misplaced
 * click cannot close a return nobody has seen.
 */
export function OrdersMarkReturned({ orderId, externalOrderId }: { orderId: string; externalOrderId: string }) {
  const [state, action, pending] = useActionState(markReturnedV2, INITIAL)
  const [confirming, setConfirming] = useState(false)

  if (state.ok) return <span className="text-xs font-semibold text-v2-ok">{state.ok}</span>

  return (
    <form
      action={(fd) => {
        setConfirming(false)
        action(fd)
      }}
      className="flex items-center justify-end gap-2"
    >
      <input type="hidden" name="orderId" value={orderId} />
      {confirming ? (
        <>
          <input
            name="note"
            placeholder="Note (optional)"
            maxLength={500}
            autoComplete="off"
            aria-label="Return note"
            className={cx('h-8 w-36 shrink-0 rounded-full border border-v2-line bg-v2-surface px-3 text-xs text-v2-ink placeholder:text-v2-faint', v2Focus)}
          />
          <Button type="submit" size="sm" variant="primary" disabled={pending} aria-label={`Confirm ${externalOrderId} is back at the outlet`}>
            {pending ? 'Saving…' : 'Yes, returned'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Not yet
          </Button>
        </>
      ) : (
        <Button size="sm" onClick={() => setConfirming(true)} aria-label={`Mark ${externalOrderId} returned to the outlet`}>
          Mark returned
        </Button>
      )}
      {state.error ? (
        <span role="alert" className="w-full text-right text-xs font-semibold text-v2-bad">
          {state.error}
        </span>
      ) : null}
    </form>
  )
}
