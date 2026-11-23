'use client'

import { useActionState, useState } from 'react'
import { Clock } from 'lucide-react'
import { markManyReturnedV2 } from '@/app/v2/orders/actions'
import type { ReturnActionState } from '@/app/actions/returns'
import { Button, cx } from './ui'

/** A bag out longer than this, in minutes, is shown in red: it should be back by now. */
export const OVERDUE_RETURN_MIN = 120

/** "Out 3h 20m", in red once the bag has been out too long. */
export function ReturnAge({ openedAt, nowMs }: { openedAt: string; nowMs: number }) {
  const m = Math.max(0, Math.round((nowMs - new Date(openedAt).getTime()) / 60_000))
  const label = m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 1440)} days`
  const late = m >= OVERDUE_RETURN_MIN
  return (
    <span className={cx('mt-0.5 flex items-center gap-1 text-xs font-semibold tabular-nums', late ? 'text-v2-bad' : 'text-v2-muted')} title={late ? 'Out for over 2 hours' : undefined}>
      <Clock size={12} aria-hidden /> out {label}
    </span>
  )
}

/**
 * Shown when the list is filtered to one rider: they walk in with all their
 * bags, and they go back on the counter in one confirmed tap.
 */
export function ReturnsMarkAll({ ids, rider }: { ids: string[]; rider: string }) {
  const [state, action, pending] = useActionState(markManyReturnedV2, {} as ReturnActionState)
  const [confirming, setConfirming] = useState(false)
  if (state.ok) return <p className="text-[13px] font-semibold text-v2-ok">{state.ok}</p>
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 rounded-v2-md bg-v2-surface-2 px-3 py-2">
      <input type="hidden" name="orderIds" value={ids.join(',')} />
      {confirming ? (
        <>
          <span className="text-[13.5px] font-semibold">All {ids.length} bags from {rider} are on the counter?</span>
          <Button type="submit" size="sm" variant="primary" disabled={pending}>
            {pending ? 'Saving…' : 'Yes, all returned'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Not yet
          </Button>
        </>
      ) : (
        <>
          <span className="text-[13.5px] text-v2-ink-2">{rider} has {ids.length} bags on this page.</span>
          <Button size="sm" variant="primary" onClick={() => setConfirming(true)}>
            Mark all {ids.length} returned
          </Button>
        </>
      )}
      {state.error ? <span role="alert" className="w-full text-xs font-semibold text-v2-bad">{state.error}</span> : null}
    </form>
  )
}
