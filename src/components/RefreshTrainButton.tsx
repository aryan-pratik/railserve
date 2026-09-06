'use client'

import { useActionState } from 'react'
import { IconRefresh } from './Icons'
import { IconButton, Spinner } from './ui'

export type RefreshTrainState = { error?: string; ok?: string }

/**
 * "Check now" for one train: bypasses the polling tier and asks the provider
 * immediately, whatever the row's age.
 *
 * One button per TRAIN, not per order: the cache row this hits is shared by
 * every order riding it, so refreshing from any one of them updates all the
 * others.
 */
export function RefreshTrainButton({
  orderId, action,
}: {
  orderId: string
  action: (prev: RefreshTrainState, formData: FormData) => Promise<RefreshTrainState>
}) {
  const [state, formAction, pending] = useActionState(action, {})

  return (
    <form action={formAction} className="inline-flex items-center gap-1">
      <input type="hidden" name="orderId" value={orderId} />
      <IconButton
        type="submit"
        size="sm"
        disabled={pending}
        aria-label="Check this train now"
        title={state.error ?? 'Check this train now, instead of waiting for the next automatic check'}
      >
        {pending ? <Spinner size={14} /> : <IconRefresh size={14} />}
      </IconButton>
      {state.error ? (
        <span role="alert" className="text-[11px] font-medium text-red-600">{state.error}</span>
      ) : null}
    </form>
  )
}
