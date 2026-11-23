'use client'

import { useActionState, useCallback, useEffect, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { updatePaymentRemark, type PaymentActionState } from '@/app/v2/payments/actions'
import { Button, cx, v2Focus } from './ui'
import { FloatingPanel } from './Floating'

const INITIAL: PaymentActionState = {}

/**
 * The remark cell: read-only text for a telecaller, a popover editor with an
 * explicit Save for admin and store manager. The remark is still the only
 * thing that ties a payment to an order, so it gets a deliberate save rather
 * than a blur that silently writes whatever was half typed.
 */
export function PaymentsRemark({ paymentId, remark, canEdit }: { paymentId: string; remark: string | null; canEdit: boolean }) {
  const [open, setOpen] = useState(false)

  if (!canEdit) {
    return remark ? <span className="block max-w-[28rem] whitespace-normal break-words">{remark}</span> : <span className="text-v2-faint">—</span>
  }

  return (
    <span className="relative block">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={remark ? 'Edit remark' : 'Add a remark'}
        className={cx('group/remark flex max-w-[28rem] items-start gap-1.5 rounded text-left', v2Focus)}
      >
        <span className={cx('min-w-0 flex-1 whitespace-normal break-words', remark ? 'text-v2-ink' : 'text-v2-faint')}>{remark ?? 'Add a remark'}</span>
        <Pencil size={13} aria-hidden className="mt-0.5 shrink-0 text-v2-faint opacity-0 transition-opacity group-hover/remark:opacity-100 group-focus-visible/remark:opacity-100 pointer-coarse:opacity-100" />
      </button>
      {open ? <RemarkPopover paymentId={paymentId} initial={remark} onClose={() => setOpen(false)} /> : null}
    </span>
  )
}

function RemarkPopover({ paymentId, initial, onClose }: { paymentId: string; initial: string | null; onClose: () => void }) {
  const [state, formAction, pending] = useActionState(updatePaymentRemark, INITIAL)
  const root = useRef<HTMLDivElement>(null)
  const marker = useRef<HTMLSpanElement>(null)
  const getAnchor = useCallback(() => marker.current?.parentElement ?? null, [])

  // Closing unmounts this, so an identity change in onClose is harmless.
  useEffect(() => {
    if (state.ok) onClose()
  }, [state.ok, onClose])

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <>
      <span ref={marker} hidden />
      <FloatingPanel getAnchor={getAnchor} label="Edit remark">
        <div
          ref={root}
          className="w-[min(22rem,calc(100vw-2rem))] rounded-v2-lg border border-v2-line bg-v2-surface p-3 shadow-v2-pop"
        >
          <form action={formAction} className="grid gap-2">
            <input type="hidden" name="paymentId" value={paymentId} />
            <input
              name="remark"
              defaultValue={initial ?? ''}
              autoFocus
              maxLength={200}
              placeholder="e.g. order 1000584805"
              aria-label="Remark"
              autoComplete="off"
              className={cx('h-10 w-full rounded-full border border-v2-line bg-v2-surface px-3.5 text-sm text-v2-ink placeholder:text-v2-faint', v2Focus)}
            />
            <p className="text-xs text-v2-muted">Put the order id in the remark to link this payment to it.</p>
            <div className="flex items-center gap-2">
              <Button type="submit" variant="primary" size="sm" disabled={pending}>
                {pending ? 'Saving…' : 'Save'}
              </Button>
              <Button size="sm" onClick={onClose}>
                Cancel
              </Button>
            </div>
            {state.error ? (
              <span role="alert" className="text-xs font-semibold text-v2-bad">
                {state.error}
              </span>
            ) : null}
          </form>
        </div>
      </FloatingPanel>
    </>
  )
}
