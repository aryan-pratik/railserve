'use client'

import { useActionState, useCallback, useEffect, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { TERMINAL_STATUSES } from '@/lib/orderStatus'
import { setOrderStatusV2 } from '@/app/v2/orders/actions'
import type { ActionState } from '@/app/admin/orders/actions'
import { Button, Chip, Mono, cx, statusChip, v2Focus } from './ui'
import { Select } from './Select'
import { FloatingPanel, insideFloating } from './Floating'

const WIDTH = 288
const INITIAL: ActionState = {}

/**
 * The admin's "set any status" on a table row: a pencil beside the chip that
 * opens a small panel with a dropdown of the order statuses, an explicit Save, and a second step for anything
 * terminal, because a closed order drops off the kitchen's board at once.
 *
 * Drawn on the page (Floating.tsx) rather than hung inside the cell: every
 * table here scrolls sideways in a TableFrame, which would clip it.
 */
export function OrdersStatusPopover({
  orderId,
  externalOrderId,
  current,
  options,
}: {
  orderId: string
  externalOrderId: string
  current: string
  options: string[]
}) {
  const [open, setOpen] = useState(false)
  const [choice, setChoice] = useState(current)
  const [confirming, setConfirming] = useState(false)
  // Saved: the row re-renders with the new chip, so the panel closes itself.
  const [state, formAction, pending] = useActionState(async (prev: ActionState, fd: FormData) => {
    const result = await setOrderStatusV2(prev, fd)
    if (result.ok) setOpen(false)
    return result
  }, INITIAL)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const to = choice
  const getAnchor = useCallback(() => buttonRef.current, [])
  const terminal = (TERMINAL_STATUSES as readonly string[]).includes(to)
  const changed = Boolean(to) && to !== current

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || buttonRef.current?.contains(t) || insideFloating(e.target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const show = () => {
    setChoice(current)
    setConfirming(false)
    setOpen(true)
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          if (open) setOpen(false)
          else show()
        }}
        aria-label={`Change status of ${externalOrderId}`}
        aria-expanded={open}
        className={cx('grid h-6 w-6 place-items-center rounded-full text-v2-faint hover:bg-v2-surface-2 hover:text-v2-ink', v2Focus)}
      >
        <Pencil size={12} aria-hidden />
      </button>

      {open ? (
        <FloatingPanel getAnchor={getAnchor} gap={6} label={`Status of ${externalOrderId}`}>
        <div
          ref={panelRef}
          style={{ width: WIDTH }}
          onClick={(e) => e.stopPropagation()}
          className="grid gap-3 whitespace-normal rounded-v2-md border border-v2-line bg-v2-surface p-3.5 text-left shadow-v2-pop"
        >
          <form action={formAction} className="grid gap-3">
            <input type="hidden" name="orderId" value={orderId} />
            <input type="hidden" name="to" value={to} />
            <div className="flex items-center justify-between gap-2 text-xs text-v2-muted">
              <Mono className="font-semibold text-v2-ink">{externalOrderId}</Mono>
              <Chip tone={statusChip(current).tone}>{statusChip(current).label}</Chip>
            </div>

            {confirming ? (
              <>
                <p className="text-sm">
                  Set this order to <b>{statusChip(to).label}</b>? That closes it: it leaves the kitchen board and the
                  rider&rsquo;s list straight away.
                </p>
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
                    Back
                  </Button>
                  <Button type="submit" size="sm" variant="danger" disabled={pending}>
                    {pending ? 'Saving…' : 'Yes, set it'}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <label className="grid gap-1 text-xs font-semibold text-v2-muted">
                  New status
                  <Select
                    value={choice}
                    onChange={setChoice}
                    buttonClassName="h-9 text-[13px]"
                    options={options.map((s) => ({ value: s, label: statusChip(s).label }))}
                  />
                </label>
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  {terminal ? (
                    <Button size="sm" variant="primary" disabled={!changed || pending} onClick={() => setConfirming(true)}>
                      Save
                    </Button>
                  ) : (
                    <Button type="submit" size="sm" variant="primary" disabled={!changed || pending}>
                      {pending ? 'Saving…' : 'Save'}
                    </Button>
                  )}
                </div>
              </>
            )}
            {state.error ? (
              <p role="alert" className="text-xs font-semibold text-v2-bad">
                {state.error}
              </p>
            ) : null}
          </form>
        </div>
        </FloatingPanel>
      ) : null}
    </>
  )
}
