'use client'

import { useActionState } from 'react'
import { assignRunAction, type AssignRunState } from './actions'

const initial: AssignRunState = {}

export function AssignRunForm({
  runKey, agents, assigned,
}: {
  runKey: string
  agents: { id: string; name: string }[]
  assigned: string[]
}) {
  const [state, action, pending] = useActionState(assignRunAction, initial)

  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="runKey" value={runKey} />
      <div className="flex flex-wrap gap-3">
        {agents.map((a) => (
          <label key={a.id} className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" name="agentIds" value={a.id}
              defaultChecked={assigned.includes(a.id)} className="rounded border-slate-300" />
            {a.name}
          </label>
        ))}
      </div>
      <button type="submit" disabled={pending}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
        {pending ? 'Saving…' : 'Assign run'}
      </button>
      {state.error ? <span className="text-xs font-medium text-red-600">{state.error}</span> : null}
      {state.ok ? <span className="text-xs font-medium text-emerald-700">{state.ok}</span> : null}
    </form>
  )
}
