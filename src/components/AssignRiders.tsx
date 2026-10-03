'use client'

import { useActionState } from 'react'
import { Button, Card, CardHeader, FormNote } from '@/components/ui'
import { assignRidersAction, type AssignRidersState } from '@/app/actions/assignRiders'

const initial: AssignRidersState = {}

/**
 * Who carries this order. The rider sees it in their app the moment it is
 * saved, and sees nothing they have not been given. More than one is valid for
 * a big order.
 */
export function AssignRidersCard({
  orderId,
  riders,
  assigned,
}: {
  orderId: string
  riders: { id: string; name: string; phone: string }[]
  assigned: string[]
}) {
  const [state, action, pending] = useActionState(assignRidersAction, initial)

  return (
    <Card>
      <CardHeader title="Rider" />
      <form action={action} className="space-y-3 p-4">
        <input type="hidden" name="orderId" value={orderId} />
        {riders.length === 0 ? (
          <p className="text-sm text-muted">No active riders at this outlet. Add one under Setup, Staff.</p>
        ) : (
          <div className="space-y-1">
            {riders.map((r) => (
              <label
                key={r.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1.5 text-sm hover:bg-sunken"
              >
                <input
                  type="checkbox"
                  name="riderIds"
                  value={r.id}
                  defaultChecked={assigned.includes(r.id)}
                  className="size-4 rounded border-line-strong accent-accent"
                />
                <span className="font-medium text-ink">{r.name}</span>
                <span className="font-mono text-xs tabular-nums text-faint">{r.phone}</span>
              </label>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" pending={pending} disabled={riders.length === 0}>
            Save rider
          </Button>
          <FormNote state={state} />
        </div>
      </form>
    </Card>
  )
}
