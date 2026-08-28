'use client'

import { useActionState, useState } from 'react'
import { Button, FormNote } from '@/components/ui'
import { shouldWarnAboutDelay } from '@/lib/train/policy'
import { acceptRun, generateRunKot, markRunPrepared, type StoreActionState } from './actions'

const initial: StoreActionState = {}

function formatDelay(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/**
 * Whole-train actions.
 *
 * Only the step the run is actually waiting on is offered. Showing Accept,
 * Print and Ready together would mean reading three buttons to find the one
 * that does anything — the board's job is to make the next move obvious.
 */
export function StoreRunActions({
  runKey,
  counts,
  trainNo,
  delayMinutes,
  expectedArrival,
  delayThresholdMinutes,
}: {
  runKey: string
  counts: Record<string, number>
  trainNo: string | null
  delayMinutes: number | null
  expectedArrival: string | null
  delayThresholdMinutes: number
}) {
  const [acceptState, accept, accepting] = useActionState(acceptRun, initial)
  const [readyState, ready, readying] = useActionState(markRunPrepared, initial)
  const [confirmingPrint, setConfirmingPrint] = useState(false)

  const toAccept = counts.RECEIVED ?? 0
  const toPrint = counts.ACCEPTED ?? 0
  const toReady = counts.KOT_PRINTED ?? 0
  const waiting = counts.PREPARED ?? 0

  // Plan §9's delay guard, on the surface that is actually used. The per-order
  // button asks the server for live status; here the board already holds it, so
  // the check is local and instant. It asks, it never blocks — the system does
  // not know how long the dish keeps or how full the pass is.
  const late = shouldWarnAboutDelay(delayMinutes, delayThresholdMinutes)

  return (
    <div className="flex flex-wrap items-center gap-2">
      {toAccept > 0 ? (
        <form action={accept}>
          <input type="hidden" name="runKey" value={runKey} />
          <Button type="submit" size="sm" disabled={accepting}>
            {accepting ? 'Accepting…' : `Accept ${toAccept}`}
          </Button>
          <FormNote state={acceptState} />
        </form>
      ) : null}

      {toPrint > 0 ? (
        late ? (
          <Button type="button" size="sm" onClick={() => setConfirmingPrint(true)}>
            Print {toPrint} KOT{toPrint === 1 ? '' : 's'}
          </Button>
        ) : (
          <form action={generateRunKot}>
            <input type="hidden" name="runKey" value={runKey} />
            <Button type="submit" size="sm">
              Print {toPrint} KOT{toPrint === 1 ? '' : 's'}
            </Button>
          </form>
        )
      ) : null}

      {toReady > 0 ? (
        <form action={ready}>
          <input type="hidden" name="runKey" value={runKey} />
          <Button type="submit" size="sm" variant="go" disabled={readying}>
            {readying ? 'Saving…' : `Mark ${toReady} ready`}
          </Button>
          <FormNote state={readyState} />
        </form>
      ) : null}

      {toAccept + toPrint + toReady === 0 && waiting > 0 ? (
        <span className="text-xs font-medium text-emerald-700">
          {waiting} on the ready shelf — waiting for the rider
        </span>
      ) : null}

      {confirmingPrint ? (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={`kot-delay-${runKey}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
        >
          <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-5 shadow-xl">
            <h3 id={`kot-delay-${runKey}`} className="text-base font-semibold text-ink">
              <span className="font-mono">{trainNo ?? 'This train'}</span> is running late
            </h3>
            <p className="mt-2 text-sm text-muted">
              Running <strong className="text-ink">{formatDelay(delayMinutes ?? 0)}</strong> late
              {expectedArrival ? (
                <>
                  , expected{' '}
                  <strong className="tabular-nums text-ink">
                    {new Date(expectedArrival).toLocaleTimeString('en-IN', {
                      timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true,
                    })}
                  </strong>
                </>
              ) : null}
              . Print {toPrint} KOT{toPrint === 1 ? '' : 's'} anyway? The food will sit until the
              train arrives.
            </p>
            <div className="mt-4 flex gap-2">
              <form action={generateRunKot} className="flex-1" onSubmit={() => setConfirmingPrint(false)}>
                <input type="hidden" name="runKey" value={runKey} />
                <Button type="submit" className="w-full">Print anyway</Button>
              </form>
              <Button type="button" variant="secondary" onClick={() => setConfirmingPrint(false)}>
                Wait
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
