'use client'

import { useActionState } from 'react'
import { Button, FormNote, textareaClass } from '@/components/ui'
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
 * Riders are not assigned work; the system writes whoever actually dispatched
 * or delivered. This is the exception path: someone used a colleague's phone,
 * a record is wrong. It edits history, so it is an admin-only, per-order control.
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
        <p className="text-sm text-muted">No active riders. Add one under Setup, Staff.</p>
      ) : (
        <div className="space-y-1">
          {agents.map((a) => (
            <label key={a.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1.5 text-sm hover:bg-sunken">
              <input
                type="checkbox" name="agentIds" value={a.id}
                defaultChecked={assigned.includes(a.id)}
                className="size-4 rounded border-line-strong accent-accent"
              />
              <span className="font-medium text-ink">{a.name}</span>
              <span className="font-mono text-xs tabular-nums text-faint">{a.phone}</span>
            </label>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" variant="secondary" pending={pending} disabled={agents.length === 0}>
          Correct the record
        </Button>
        <FormNote state={state} />
      </div>
      <p className="text-xs text-muted text-pretty">
        Normally filled in by whoever delivered. More than one is valid: a large bulk handover is not a one-rider job.
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
    return <p className="px-4 py-4 text-sm text-muted">Nothing further to do on this order.</p>
  }

  return (
    <div className="space-y-2 p-4">
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <form key={o.to} action={action}>
            <input type="hidden" name="orderId" value={orderId} />
            <input type="hidden" name="to" value={o.to} />
            <Button type="submit" size="sm" variant={o.tone} pending={pending}>
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
 * Free-text instruction for the kitchen ("less spicy"), separate from the
 * read-only creation-time Notes and never printed on the KOT.
 */
export function RemarkForm({ orderId, remark }: { orderId: string; remark: string | null }) {
  const [state, action, pending] = useActionState(updateOrderRemarkAction, initial)

  return (
    <form action={action} className="space-y-2 p-4">
      <input type="hidden" name="orderId" value={orderId} />
      <label htmlFor="order-remark" className="sr-only">Remark</label>
      <textarea
        id="order-remark"
        name="remark"
        defaultValue={remark ?? ''}
        maxLength={500}
        rows={3}
        placeholder="e.g. Make it less spicy"
        className={textareaClass}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" variant="secondary" pending={pending}>
          Save remark
        </Button>
        <FormNote state={state} />
      </div>
    </form>
  )
}
