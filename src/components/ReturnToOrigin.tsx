'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { Button, Card, CardHeader, FormNote, Notice, inputClass } from '@/components/ui'
import { formatIST } from '@/lib/format'
import { rtoReasonLabel, RTO_NOTE_MAX } from '@/lib/rto'
import { markReturnedAction, type ReturnActionState } from '@/app/actions/returns'

const initial: ReturnActionState = {}

/**
 * "The bag is back on the counter." Two taps, not one, like collecting cash:
 * the second is the person saying the food is in their hands. A single
 * misplaced click would otherwise close a return for a bag nobody has seen.
 *
 * `compact` is the row variant on the returns list; the full form on an
 * order's own card also takes a note ("two of three thalis came back").
 */
export function MarkReturnedButton({
  orderId,
  externalOrderId,
  compact = false,
}: {
  orderId: string
  externalOrderId: string
  compact?: boolean
}) {
  const [state, action, pending] = useActionState(markReturnedAction, initial)
  const [confirming, setConfirming] = useState(false)

  if (state.ok) {
    return <span className="text-sm font-medium text-emerald-700">{state.ok}</span>
  }

  return (
    <form
      action={(fd) => {
        setConfirming(false)
        action(fd)
      }}
      className={compact ? 'flex flex-wrap items-center justify-end gap-2' : 'space-y-3'}
    >
      <input type="hidden" name="orderId" value={orderId} />
      {confirming ? (
        <>
          {!compact ? (
            <div>
              <label htmlFor={`rto-note-${orderId}`} className="mb-1 block text-xs font-medium text-muted">
                Note, if not everything came back (optional)
              </label>
              <input
                id={`rto-note-${orderId}`}
                name="note"
                maxLength={RTO_NOTE_MAX}
                placeholder="e.g. Two of three thalis, water missing"
                className={inputClass}
              />
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">Bag in hand?</span>
            <Button
              type="submit"
              size="sm"
              variant="go"
              pending={pending}
              aria-label={`Confirm ${externalOrderId} is back at the outlet`}
            >
              Yes, returned
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Not yet
            </Button>
          </div>
        </>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          pending={pending}
          onClick={() => setConfirming(true)}
          aria-label={`Mark ${externalOrderId} returned to the outlet`}
        >
          Mark returned
        </Button>
      )}
      <FormNote state={state} className={compact ? 'w-full text-right text-xs' : ''} />
    </form>
  )
}

export type ReturnInfo = {
  status: 'PENDING' | 'RETURNED'
  reason: string
  openedAt: string
  returnedAt: string | null
  returnedBy: string | null
  note: string | null
  riders: string[]
}

/**
 * The return as it stands, on an order's own page.
 *
 * `canCollect` is true for whoever the admin has let collect at the counter
 * (and for an admin), who get the button while it is pending. Everyone else
 * reads it. `outletName` is where the bag is going: a rider or a telecaller
 * across the room needs that said; a manager at that counter does not.
 */
export function ReturnToOriginCard({
  orderId,
  externalOrderId,
  info,
  canCollect,
  outletName,
}: {
  orderId: string
  externalOrderId: string
  info: ReturnInfo
  canCollect: boolean
  outletName?: string | null
}) {
  const pending = info.status === 'PENDING'
  const riders = info.riders.length > 0 ? info.riders.join(', ') : 'the rider'
  return (
    <Card>
      <CardHeader title={pending ? 'Coming back to the outlet' : 'Returned to the outlet'} />
      <div className="space-y-3 p-4">
        <div
          className={`rounded-lg px-4 py-3 text-sm ring-1 ring-inset ${
            pending ? 'bg-amber-50 text-amber-900 ring-amber-200' : 'bg-emerald-50 text-emerald-900 ring-emerald-200'
          }`}
        >
          <p className="font-medium">
            {rtoReasonLabel(info.reason)} · {pending ? `${riders} has the bag` : `brought back by ${riders}`}
            {outletName ? ` · ${outletName}` : ''}
          </p>
          <p className="mt-1 text-xs opacity-80">
            {pending
              ? `Out since ${formatIST(info.openedAt)}. The outlet marks it returned when the bag is on the counter.`
              : `Taken back by ${info.returnedBy ?? 'unknown'} · ${formatIST(info.returnedAt)}`}
          </p>
          {info.note ? <p className="mt-1 text-xs">&ldquo;{info.note}&rdquo;</p> : null}
        </div>

        {pending && canCollect ? (
          <MarkReturnedButton orderId={orderId} externalOrderId={externalOrderId} />
        ) : null}
        {pending && !canCollect ? (
          <p className="text-sm text-muted">Waiting for the outlet to take the bag back.</p>
        ) : null}
      </div>
    </Card>
  )
}

/**
 * One line at the top of a board: how many bags are still out, and where the
 * list is. Renders nothing when there are none, which is most of the time.
 */
export function ReturnsNotice({ count, href }: { count: number; href: string }) {
  if (count === 0) return null
  return (
    <Notice tone="warn">
      {count === 1 ? 'One order is' : `${count} orders are`} coming back from a rider and still to be
      collected at the counter.{' '}
      <Link href={href} className="underline underline-offset-2">
        See returns
      </Link>
    </Notice>
  )
}
