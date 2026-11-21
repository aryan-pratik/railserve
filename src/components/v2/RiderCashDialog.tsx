'use client'

import { useActionState, useEffect, useMemo, useState } from 'react'
import { collectRiderCashV2, type FormState } from '@/app/v2/riders/actions'
import { formatRupees, formatTimeIST } from '@/lib/format'
import type { DueOrder } from '@/lib/v2/riders'
import { Button, Mono, cx } from './ui'
import { RiderDialog, RiderFormNote } from './RiderDialog'

const initial: FormState = {}

/**
 * Taking a rider's cash. The dialog lists the exact orders the money is on
 * and takes the amount actually received: the full total by default, or a
 * smaller figure typed in. A smaller figure clears the oldest orders whole
 * and leaves the balance on the next one, which stays in the rider's wallet.
 * Two taps: the second is the receiver saying the notes are in their hand.
 */
export function RiderCashDialog({
  rider,
  orders,
  onClose,
  onSettled,
}: {
  rider: { id: string; name: string }
  orders: DueOrder[]
  onClose: () => void
  /** Called once the handover is recorded, so the board can refetch. */
  onSettled: () => void
}) {
  const [state, action, pending] = useActionState(collectRiderCashV2, initial)
  const [confirming, setConfirming] = useState(false)
  const total = orders.reduce((a, o) => a + o.paise, 0)
  const [rupees, setRupees] = useState(() => String(Math.round(total / 100)))
  const first = rider.name.split(/\s+/)[0]

  useEffect(() => {
    if (state.ok) onSettled()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok])

  const paise = Math.round((Number(rupees) || 0) * 100)
  const valid = paise > 0 && paise <= total
  const isFull = paise === total

  // What the typed amount would do, in the same order the server applies it.
  const preview = useMemo(() => {
    let carry = paise
    const cleared: string[] = []
    let partial: { id: string; paid: number; left: number } | null = null
    for (const o of orders) {
      if (carry <= 0) break
      if (carry >= o.paise) {
        cleared.push(o.id)
        carry -= o.paise
      } else {
        partial = { id: o.id, paid: carry, left: o.paise - carry }
        carry = 0
      }
    }
    return { cleared: new Set(cleared), partial }
  }, [paise, orders])

  return (
    <RiderDialog
      title={`Collect cash from ${first}`}
      titleId="rider-cash-dialog"
      note={`${orders.length} delivered COD order${orders.length === 1 ? '' : 's'} not yet received, every day`}
      onClose={onClose}
      role="alertdialog"
      footer={
        state.ok ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : confirming ? (
          <form action={action} className="flex flex-wrap items-center justify-end gap-2" onSubmit={() => setConfirming(false)}>
            <input type="hidden" name="riderId" value={rider.id} />
            <input type="hidden" name="orderIds" value={orders.map((o) => o.id).join(',')} />
            {!isFull ? <input type="hidden" name="rupees" value={String(paise / 100)} /> : null}
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
              Back
            </Button>
            <Button type="submit" variant="primary" disabled={pending} aria-label={`Confirm ${formatRupees(paise)} received from ${rider.name}`}>
              {pending ? 'Recording…' : `Yes, I have ${formatRupees(paise)}`}
            </Button>
          </form>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => setConfirming(true)} disabled={orders.length === 0 || !valid}>
              Received {valid ? formatRupees(paise) : '…'}
            </Button>
          </>
        )
      }
    >
      {state.ok ? (
        <RiderFormNote state={state} />
      ) : (
        <div className="grid gap-4">
          {confirming ? (
            <p className="rounded-v2-md bg-v2-cod-bg px-4 py-3 text-sm font-medium text-v2-cod">
              Count the notes first. Recording this takes {formatRupees(paise)} off {first}&apos;s wallet and cannot be undone.
              {preview.partial ? ` ${formatRupees(preview.partial.left)} stays due on the part-paid order.` : ''}
            </p>
          ) : null}

          <div className="grid gap-1.5">
            <label htmlFor="rider-cash-amount" className="text-[12.5px] font-semibold text-v2-ink-2">
              Amount received
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <span className="relative">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-sm text-v2-muted">₹</span>
                <input
                  id="rider-cash-amount"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={Math.round(total / 100)}
                  step={1}
                  value={rupees}
                  disabled={confirming || orders.length === 0}
                  onChange={(e) => setRupees(e.target.value)}
                  className={cx(
                    'h-11 w-40 rounded-full border bg-v2-surface pl-8 pr-3.5 font-mono text-[18px] font-bold tabular-nums text-v2-ink outline-none focus:ring-[3px] focus:ring-v2-brand-soft',
                    valid || !rupees ? 'border-v2-line-strong focus:border-v2-brand' : 'border-v2-bad',
                  )}
                />
              </span>
              <Button type="button" size="sm" variant={isFull ? 'soft' : 'secondary'} onClick={() => setRupees(String(Math.round(total / 100)))} disabled={confirming}>
                Full {formatRupees(total)}
              </Button>
            </div>
            {!valid && rupees ? (
              <span className="text-xs font-medium text-v2-bad">Enter between ₹1 and {formatRupees(total)}.</span>
            ) : !isFull && valid ? (
              <span className="text-xs text-v2-muted">
                Partial: {preview.cleared.size} order{preview.cleared.size === 1 ? '' : 's'} cleared
                {preview.partial ? `, ${formatRupees(preview.partial.paid)} against the next, ${formatRupees(total - paise)} stays with ${first}` : `, ${formatRupees(total - paise)} stays with ${first}`}.
              </span>
            ) : (
              <span className="text-xs text-v2-muted">Type a smaller figure if {first} is handing in part of it.</span>
            )}
          </div>

          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[12.5px] font-semibold text-v2-ink-2">Orders behind the amount · oldest first</span>
            <span className="font-mono text-[22px] font-bold tabular-nums tracking-[-0.02em]">{formatRupees(total)}</span>
          </div>
          <ul className="divide-y divide-v2-line rounded-v2-md border border-v2-line">
            {orders.map((o) => {
              const cleared = preview.cleared.has(o.id)
              const part = preview.partial?.id === o.id ? preview.partial : null
              return (
                <li key={o.id} className={cx('grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-2.5 text-sm', !cleared && !part && valid && 'opacity-50')}>
                  <span className="min-w-0">
                    <Mono className="block truncate font-semibold">{o.externalOrderId ?? o.id}</Mono>
                    <span className="block truncate text-xs text-v2-muted">
                      {[o.trainNo ? `Train ${o.trainNo}` : null, o.contactName, o.deliveredAt ? `delivered ${formatTimeIST(o.deliveredAt)}` : null, o.partPaidPaise ? `${formatRupees(o.partPaidPaise)} already handed in` : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <span className="text-right">
                    <Mono className="block font-semibold">{formatRupees(o.paise)}</Mono>
                    {part ? <span className="block text-[11px] font-semibold text-v2-cod">{formatRupees(part.paid)} now · {formatRupees(part.left)} due</span> : cleared && !isFull ? <span className="block text-[11px] font-semibold text-v2-ok">cleared</span> : null}
                  </span>
                </li>
              )
            })}
            {orders.length === 0 ? <li className="px-3.5 py-4 text-center text-sm text-v2-muted">Nothing pending.</li> : null}
          </ul>
          <RiderFormNote state={state} />
        </div>
      )}
    </RiderDialog>
  )
}
