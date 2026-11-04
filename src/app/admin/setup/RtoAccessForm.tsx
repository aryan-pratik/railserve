'use client'

import { useActionState } from 'react'
import { Button, Card, CardHeader, FormNote, focusRing } from '@/components/ui'
import { ROLE_LABEL } from '@/lib/roles'
import { RTO_COLLECTOR_ROLE_OPTIONS } from '@/lib/rto'
import { setRtoCollectRolesAction, type AccessState } from './accessActions'

const initial: AccessState = {}

/** What each role is, for the admin deciding whether to hand them the counter. */
const ROLE_NOTE: Record<(typeof RTO_COLLECTOR_ROLE_OPTIONS)[number], string> = {
  STORE_MANAGER: 'At the counter the bag comes back to. The usual choice.',
  TELECALLER: 'Only if the call desk sits at the outlet and physically takes bags back.',
}

/**
 * Who may mark a return as back at the outlet. An admin always can and is
 * not offered as a box; a rider never can and is not either — they are the
 * one handing the bag over, and the mark is somebody else confirming it.
 */
export function RtoAccessForm({ allowed }: { allowed: readonly string[] }) {
  const [state, action, pending] = useActionState(setRtoCollectRolesAction, initial)
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Who collects returns" />
      <form action={action} className="space-y-4 px-3 py-3">
        <p className="text-sm text-muted">
          When an order is cancelled or not delivered after a rider has taken it, the bag goes back
          to the outlet it left, and someone there marks it returned (RTO, return to origin). Tick
          the roles allowed to do that. Admins always can.
        </p>
        <ul className="space-y-2">
          {RTO_COLLECTOR_ROLE_OPTIONS.map((role) => (
            <li key={role}>
              <label className={`flex cursor-pointer items-start gap-3 rounded-lg px-2 py-1.5 hover:bg-sunken ${focusRing}`}>
                <input
                  type="checkbox"
                  name="role"
                  value={role}
                  defaultChecked={allowed.includes(role)}
                  className="mt-1 size-4 accent-accent"
                />
                <span>
                  <span className="block text-sm font-medium text-ink">{ROLE_LABEL[role]}</span>
                  <span className="block text-xs text-muted">{ROLE_NOTE[role]}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" pending={pending}>
            Save
          </Button>
          <FormNote state={state} />
        </div>
      </form>
    </Card>
  )
}
