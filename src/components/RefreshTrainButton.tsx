'use client'

import { useActionState } from 'react'

export type RefreshTrainState = { error?: string; ok?: string }

/**
 * "Check now" for one train — bypasses the tier and asks the provider
 * immediately, whatever the row's age.
 *
 * One button per TRAIN, not per order: the cache row this hits is shared by
 * every order riding it, so refreshing from any one of them already updates
 * all the others. A button on every order row would imply each gets its own
 * independent check, which is not what happens — one click here is the whole
 * group's answer.
 *
 * Icon-only and compact on purpose: this sits inline with the delay/platform
 * badges next to a train's timing, not as a standalone call to action.
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
      <button
        type="submit"
        disabled={pending}
        title={state.error ?? 'Check this train right now, instead of waiting for the next automatic check'}
        className="rounded p-1 text-faint transition hover:bg-sunken hover:text-ink disabled:opacity-50"
      >
        <span aria-hidden className={`inline-block text-sm ${pending ? 'animate-spin' : ''}`}>
          ↻
        </span>
        <span className="sr-only">Refresh live status now</span>
      </button>
      {state.error ? (
        <span className="text-[10px] font-medium text-red-600">{state.error}</span>
      ) : null}
    </form>
  )
}
