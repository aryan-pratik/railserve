'use client'

import { useActionState } from 'react'
import { Button, FormNote } from '@/components/ui'
import {
  adminTransitionAction,
  assignAgentsAction,
  updateOrderRemarkAction,
  type ActionState,
} from './actions'

const initial: ActionState = {}

/**
 * Corrects who is recorded as having delivered an order.
 *
 * Riders are not assigned work any more — the system writes whoever actually
 * dispatched or delivered. This is the exception path: someone used a
 * colleague's phone, a record is wrong, a delivery was logged by the wrong
 * account. It edits history, so it is deliberately an admin-only, per-order
 * control rather than anything on a board.
 */
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
        <p className="text-sm text-muted">No active riders. Add one under Setup → Staff.</p>
      ) : (
        <div className="space-y-2">
          {agents.map((a) => (
            <label key={a.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox" name="agentIds" value={a.id}
                defaultChecked={assigned.includes(a.id)}
                className="rounded border-line-strong"
              />
              <span className="font-medium text-ink">{a.name}</span>
              <span className="text-faint">{a.phone}</span>
            </label>
          ))}
        </div>
      )}

      <FormNote state={state} />

      <Button type="submit" size="sm" variant="secondary" disabled={pending || agents.length === 0}>
        {pending ? 'Saving…' : 'Correct the record'}
      </Button>
      <p className="text-xs text-muted">
        Normally filled in automatically by whoever delivered. More than one is
        valid — a large bulk handover is not a one-rider job.
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
    return <p className="px-4 py-4 text-sm text-faint">No further actions available to you.</p>
  }

  return (
    <div className="space-y-2 p-4">
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <form key={o.to} action={action}>
            <input type="hidden" name="orderId" value={orderId} />
            <input type="hidden" name="to" value={o.to} />
            <Button type="submit" size="sm" variant={o.tone} disabled={pending}>
              {o.label}
            </Button>
          </form>
        ))}
      </div>
      <FormNote state={state} />
    </div>
  )
}

/**
 * Free-text instruction for the kitchen/store (e.g. "less spicy"), separate
 * from the read-only creation-time Notes card and never printed on the KOT.
 * Editable any time, not just at accept — the admin usually fills it in
 * right when accepting, but nothing enforces that.
 */
export function RemarkForm({ orderId, remark }: { orderId: string; remark: string | null }) {
  const [state, action, pending] = useActionState(updateOrderRemarkAction, initial)

  return (
    <form action={action} className="space-y-2 p-4">
      <input type="hidden" name="orderId" value={orderId} />
      <textarea
        name="remark"
        defaultValue={remark ?? ''}
        maxLength={500}
        rows={3}
        placeholder="e.g. Make it less spicy"
        className="w-full rounded-lg border border-line-strong bg-transparent p-2 text-sm"
      />
      <FormNote state={state} />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? 'Saving…' : 'Save remark'}
      </Button>
    </form>
  )
}
