'use client'

import { useActionState } from 'react'
import { adminTransitionAction, assignAgentsAction, type ActionState } from './actions'

const initial: ActionState = {}

export function AssignAgents({
  orderId, agents, assigned,
}: {
  orderId: string
  agents: { id: string; name: string; phone: string }[]
  assigned: string[]
}) {
  const [state, action, pending] = useActionState(assignAgentsAction, initial)

  return (
    <form action={action} className="space-y-3 p-4">
      <input type="hidden" name="orderId" value={orderId} />
      {agents.length === 0 ? (
        <p className="text-sm text-slate-500">No active delivery agents. Add one under Staff.</p>
      ) : (
        <div className="space-y-2">
          {agents.map((a) => (
            <label key={a.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox" name="agentIds" value={a.id}
                defaultChecked={assigned.includes(a.id)}
                className="rounded border-slate-300"
              />
              <span className="font-medium text-slate-900">{a.name}</span>
              <span className="text-slate-500">{a.phone}</span>
            </label>
          ))}
        </div>
      )}

      {state.error ? <p className="text-xs font-medium text-red-600">{state.error}</p> : null}
      {state.ok ? <p className="text-xs font-medium text-emerald-700">{state.ok}</p> : null}

      <button
        type="submit" disabled={pending || agents.length === 0}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        {pending ? 'Saving…' : 'Save assignment'}
      </button>
      <p className="text-xs text-slate-500">
        Multiple agents are allowed — a large bulk handover is not a one-agent job.
      </p>
    </form>
  )
}

export function TransitionButtons({
  orderId, options,
}: {
  orderId: string
  options: { to: string; label: string; tone: 'primary' | 'danger' }[]
}) {
  const [state, action, pending] = useActionState(adminTransitionAction, initial)

  if (options.length === 0) {
    return <p className="px-4 py-4 text-sm text-slate-500">No further actions available to you.</p>
  }

  return (
    <div className="space-y-2 p-4">
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <form key={o.to} action={action}>
            <input type="hidden" name="orderId" value={orderId} />
            <input type="hidden" name="to" value={o.to} />
            <button
              type="submit" disabled={pending}
              className={
                o.tone === 'danger'
                  ? 'rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50'
                  : 'rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50'
              }
            >
              {o.label}
            </button>
          </form>
        ))}
      </div>
      {state.error ? <p className="text-xs font-medium text-red-600">{state.error}</p> : null}
      {state.ok ? <p className="text-xs font-medium text-emerald-700">{state.ok}</p> : null}
    </div>
  )
}
