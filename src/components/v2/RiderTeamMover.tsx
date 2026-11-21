'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { setTeamV2, type FormState } from '@/app/v2/riders/actions'
import { Button } from './ui'
import { RiderFormNote } from './RiderDialog'
import { Select } from './Select'

const initial: FormState = {}

/**
 * Tick riders, pick where they go. One form for every move an admin makes:
 * into a team, between teams, or out of any team.
 */
export function RiderTeamMover({
  riders,
  leads,
}: {
  riders: { id: string; name: string; team: string | null }[]
  leads: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [state, action, pending] = useActionState(setTeamV2, initial)

  useEffect(() => {
    if (state.ok) router.refresh()
  }, [state.ok, router])

  if (riders.length === 0) {
    return <p className="text-sm text-v2-muted">No riders yet. Add one from the Riders page.</p>
  }
  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
        {riders.map((r) => (
          <label key={r.id} className="flex cursor-pointer items-center gap-2.5 rounded-v2-sm px-1.5 py-1.5 text-sm hover:bg-v2-surface-2">
            <input type="checkbox" name="riderIds" value={r.id} className="h-4 w-4 rounded border-v2-line-strong accent-v2-brand" />
            <span className="min-w-0 truncate">
              <span className="font-semibold">{r.name}</span>
              <span className="ml-1.5 text-xs text-v2-faint">{r.team ?? 'no team'}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Select
          name="leadId"
          defaultValue=""
          aria-label="Move to"
          className="w-auto min-w-52"
          buttonClassName="border-v2-line-strong"
          options={[{ value: '', label: 'No team' }, ...leads.map((l) => ({ value: l.id, label: `Team ${l.name}` }))]}
        />
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Moving…' : 'Move ticked riders'}
        </Button>
        <RiderFormNote state={state} />
      </div>
    </form>
  )
}
