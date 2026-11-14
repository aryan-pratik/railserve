'use client'

import { useActionState } from 'react'
import { Button, FormNote, inputClass } from '@/components/ui'
import { setTeamAction, type TeamState } from './actions'

const initial: TeamState = {}

/**
 * Tick riders, pick where they go. One form for every move an admin makes:
 * into a team, between teams, or out of any team.
 */
export function TeamMover({
  riders,
  leads,
}: {
  riders: { id: string; name: string; team: string | null }[]
  leads: { id: string; name: string }[]
}) {
  const [state, action, pending] = useActionState(setTeamAction, initial)
  if (riders.length === 0) {
    return <p className="p-4 text-sm text-muted">No riders yet. Add one under Setup, Staff.</p>
  }
  return (
    <form action={action} className="space-y-3 p-4">
      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
        {riders.map((r) => (
          <label key={r.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1.5 text-sm hover:bg-sunken">
            <input type="checkbox" name="riderIds" value={r.id} className="size-4 rounded border-line-strong accent-accent" />
            <span className="min-w-0 truncate">
              <span className="font-medium text-ink">{r.name}</span>
              <span className="ml-1.5 text-xs text-faint">{r.team ?? 'no team'}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <select name="leadId" defaultValue="" aria-label="Move to" className={`${inputClass} w-auto min-w-52`}>
          <option value="">No team</option>
          {leads.map((l) => (
            <option key={l.id} value={l.id}>Team {l.name}</option>
          ))}
        </select>
        <Button type="submit" variant="secondary" pending={pending}>Move ticked riders</Button>
        <FormNote state={state} />
      </div>
    </form>
  )
}
