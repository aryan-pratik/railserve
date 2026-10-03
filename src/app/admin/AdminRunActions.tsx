'use client'

import { useActionState, useEffect } from 'react'
import { Button, FormNote, inputBase } from '@/components/ui'
import { useRunSelection } from '@/components/RunSelection'
import { handRunToRiderAction, markRunPrepared, type StoreActionState } from '@/app/store/actions'

const initial: StoreActionState = {}

/**
 * Mark ready and hand to a rider, for one train on the admin board.
 *
 * They act on the ticked orders, or on every order this card shows when none
 * is ticked. Always by id, never "the whole run": the admin board can be
 * filtered by tab or search, and a click must not move orders the admin
 * cannot see on it.
 */
export function AdminRunActions({
  runKey,
  riders,
}: {
  runKey: string
  riders: { id: string; name: string }[]
}) {
  const selection = useRunSelection()
  const [readyState, ready, readying] = useActionState(markRunPrepared, initial)
  const [handState, hand, handing] = useActionState(handRunToRiderAction, initial)

  const clearSelection = selection?.clear
  useEffect(() => {
    if (readyState.ok || handState.ok) clearSelection?.()
  }, [readyState, handState, clearSelection])

  if (!selection) return null

  const ticked = selection.orders.filter((o) => selection.selected.has(o.id))
  const narrowed = ticked.length > 0
  const scope = narrowed ? ticked : selection.orders
  const toReady = scope.filter((o) => o.status === 'KOT_PRINTED')
  const waiting = scope.filter((o) => o.status === 'PREPARED')
  const which = narrowed ? ' selected' : ''

  if (!narrowed && toReady.length === 0 && waiting.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line bg-sunken/60 px-4 py-2.5">
      {narrowed ? (
        <span className="flex items-center gap-1.5 text-xs font-medium text-accent">
          {ticked.length} selected
          <button
            type="button"
            onClick={() => selection.clear()}
            className="rounded px-1 text-muted underline-offset-2 hover:text-ink hover:underline"
          >
            Clear
          </button>
        </span>
      ) : null}

      {narrowed && toReady.length === 0 && waiting.length === 0 ? (
        <span className="text-xs text-muted">Nothing to mark ready or hand over in this selection.</span>
      ) : null}

      {toReady.length > 0 ? (
        <form action={ready} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="runKey" value={runKey} />
          {toReady.map((o) => (
            <input key={o.id} type="hidden" name="orderId" value={o.id} />
          ))}
          <Button type="submit" size="sm" variant="go" pending={readying}>
            Mark {toReady.length}{which} ready
          </Button>
          <FormNote state={readyState} />
        </form>
      ) : null}

      {waiting.length > 0 ? (
        riders.length > 0 ? (
          <form action={hand} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="runKey" value={runKey} />
            {waiting.map((o) => (
              <input key={o.id} type="hidden" name="orderId" value={o.id} />
            ))}
            <label htmlFor={`admin-rider-${runKey}`} className="text-xs font-medium text-emerald-700">
              {narrowed ? `Hand ${waiting.length} selected to` : `${waiting.length} on the shelf. Hand to`}
            </label>
            <select
              id={`admin-rider-${runKey}`}
              name="riderId"
              required
              defaultValue=""
              className={`${inputBase} h-8 text-xs`}
            >
              <option value="" disabled>Choose a rider</option>
              {riders.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <Button type="submit" size="sm" variant="go" pending={handing}>
              On the way
            </Button>
            <FormNote state={handState} />
          </form>
        ) : (
          <span className="text-xs font-medium text-amber-700">
            {waiting.length} on the shelf, and no active rider.
          </span>
        )
      ) : null}
    </div>
  )
}
