'use client'

import { useActionState, useId } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from './ui'
import { ConfirmActionButton, FormNote, checkboxV2, inputV2, type FormState } from './OrderForms'
import { Select } from './Select'
import { RTO_NOTE_MAX } from '@/lib/rto'
import type { WorkspaceRider } from '@/lib/v2/orderWorkspace'
import { assignAgentsV2, assignRidersV2, forceRefreshOrderTrainV2, handRunToRiderV2, markReturnedV2 } from '@/app/v2/orders/[id]/actions'

const initial: FormState = {}

/** The dropdown in the square shape of the workspace's other fields. */
const formSelectButton = 'rounded-v2-md border-v2-line-strong'

/**
 * Who carries this order. The call desk and the kitchen pick from the riders
 * at the outlet; an admin may name any rider, which is the correction path
 * when the record is wrong, so a rider from another outlet is flagged.
 */
export function RidersChecklist({
  orderId,
  riders,
  assigned,
  admin,
  open,
  pickedUpBy,
}: {
  orderId: string
  riders: WorkspaceRider[]
  assigned: string[]
  admin: boolean
  /** Still routing: a rider from another outlet cannot be put on an open order. */
  open: boolean
  pickedUpBy: string | null
}) {
  const [state, action, pending] = useActionState(admin ? assignAgentsV2 : assignRidersV2, initial)
  const field = admin ? 'agentIds' : 'riderIds'
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="orderId" value={orderId} />
      {riders.length === 0 ? (
        <p className="text-sm text-v2-muted">No active riders at this outlet. Add one under Riders.</p>
      ) : (
        <div className="grid gap-0.5">
          {riders.map((r) => (
            <label key={r.id} className="flex cursor-pointer items-center gap-2.5 rounded-v2-sm px-1.5 py-1.5 text-sm hover:bg-v2-surface-2">
              <input type="checkbox" name={field} value={r.id} defaultChecked={assigned.includes(r.id)} className={checkboxV2} />
              <span className="font-semibold">{r.name}</span>
              <span className="font-mono text-xs tabular-nums text-v2-faint">{r.phone}</span>
              {r.atOutlet ? null : <span className="text-xs text-v2-warn">another outlet{open ? ', cannot see this order' : ''}</span>}
            </label>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={pending || riders.length === 0} aria-busy={pending || undefined}>
          {admin ? 'Correct the record' : 'Save rider'}
        </Button>
        <FormNote state={state} />
      </div>
      {pickedUpBy ? (
        <p className="text-xs text-v2-ink-2">
          Picked up by <b>{pickedUpBy}</b>. The order is on their record alone.
        </p>
      ) : null}
    </form>
  )
}

/**
 * "Hand to rider": the manager at the counter names who took the bag and the
 * order goes on its way under that rider's name.
 */
export function HandToRider({ orderId, runKey, riders, assigned }: { orderId: string; runKey: string; riders: WorkspaceRider[]; assigned: string[] }) {
  const [state, action, pending] = useActionState(handRunToRiderV2, initial)
  const id = useId()
  const atOutlet = riders.filter((r) => r.atOutlet)
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="runKey" value={runKey} />
      <input type="hidden" name="orderId" value={orderId} />
      {atOutlet.length === 0 ? (
        <p className="text-sm text-v2-muted">No active riders at this outlet to hand the bag to.</p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label htmlFor={id} className="grid flex-1 gap-1.5 text-xs font-semibold text-v2-ink-2">
            Rider
            <Select
              id={id}
              name="riderId"
              defaultValue={assigned[0] ?? atOutlet[0]?.id}
              className="min-w-[12rem]"
              buttonClassName={formSelectButton}
              options={atOutlet.map((r) => ({ value: r.id, label: r.name }))}
            />
          </label>
          <Button type="submit" variant="primary" disabled={pending} aria-busy={pending || undefined}>
            Hand to rider
          </Button>
        </div>
      )}
      <FormNote state={state} />
      <p className="text-xs text-v2-muted">The bag goes out under this rider&apos;s name; their app shows it at once.</p>
    </form>
  )
}

/** Two taps: the second is the person saying the bag is in their hands. */
export function MarkReturnedButton({ orderId, externalOrderId }: { orderId: string; externalOrderId: string }) {
  return (
    <ConfirmActionButton
      action={markReturnedV2}
      fields={{ orderId }}
      label="Mark returned"
      variant="primary"
      title="Bag back on the counter?"
      description={
        <>
          <span className="font-mono font-semibold text-v2-ink">{externalOrderId}</span> is marked returned to the outlet and leaves the returns list.
        </>
      }
      submitLabel="Yes, returned"
      cancelLabel="Not yet"
      extra={
        <label className="grid gap-1.5 text-xs font-semibold text-v2-ink-2">
          Note, if not everything came back (optional)
          <input name="note" maxLength={RTO_NOTE_MAX} placeholder="e.g. Two of three thalis, water missing" className={inputV2} />
        </label>
      }
    />
  )
}

/** "Check now" for the train: one cache row serves every order riding it. */
export function RefreshTrainButton({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState(forceRefreshOrderTrainV2, initial)
  return (
    <form action={action} className="inline-flex flex-wrap items-center gap-2">
      <input type="hidden" name="orderId" value={orderId} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending} aria-busy={pending || undefined} title="Ask the railway now instead of waiting for the next check">
        <RefreshCw size={14} className={pending ? 'animate-spin' : undefined} aria-hidden />
        Check now
      </Button>
      <FormNote state={state} />
    </form>
  )
}
