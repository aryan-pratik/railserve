'use client'

import { useActionState } from 'react'
import { acceptOrder, generateKot, markPrepared, type StoreActionState } from './actions'

const initial: StoreActionState = {}

function Feedback({ state }: { state: StoreActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="mt-2 text-xs font-medium text-red-600">
        {state.error}
      </p>
    )
  }
  return null
}

export function AcceptButton({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState(acceptOrder, initial)
  return (
    <form action={action}>
      <input type="hidden" name="orderId" value={orderId} />
      <button type="submit" disabled={pending}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
        {pending ? 'Accepting…' : 'Accept'}
      </button>
      <Feedback state={state} />
    </form>
  )
}

export function GenerateKotButton({ orderId, reprint }: { orderId: string; reprint?: boolean }) {
  return (
    <form action={generateKot}>
      <input type="hidden" name="orderId" value={orderId} />
      <button type="submit"
        className={
          reprint
            ? 'rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50'
            : 'rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800'
        }>
        {reprint ? 'Reprint KOT' : 'Generate KOT'}
      </button>
    </form>
  )
}

export function MarkPreparedButton({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState(markPrepared, initial)
  return (
    <form action={action}>
      <input type="hidden" name="orderId" value={orderId} />
      <button type="submit" disabled={pending}
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
        {pending ? 'Saving…' : 'Mark prepared'}
      </button>
      <Feedback state={state} />
    </form>
  )
}
