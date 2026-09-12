'use client'

import { useActionState, useState } from 'react'
import { Button, ButtonLink, FormNote, inputBase } from '@/components/ui'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { shouldWarnAboutDelay } from '@/lib/train/policy'
import {
  acceptRun, generateRunKot, handRunToRiderAction, markRunPrepared,
  type StoreActionState,
} from './actions'

const initial: StoreActionState = {}

function formatDelay(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** Same fetch-and-stay-put reprint as the single-order button, for a whole train. */
function ReprintRunKotButton({ runKey, count }: { runKey: string; count: number }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function reprint() {
    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/store/runs/${encodeURIComponent(runKey)}/kot`, { method: 'POST' })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.ok) throw new Error(body?.error ?? `Reprint failed (${res.status})`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reprint failed')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      {/* Ghost, not secondary: a recovery action, not a step in the flow —
          it shouldn't compete with "Mark ready" or "Preview" for attention. */}
      <Button type="button" size="sm" variant="ghost" onClick={() => void reprint()} pending={pending}>
        Reprint {count} KOT{count === 1 ? '' : 's'}
      </Button>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  )
}

/**
 * Whole-train actions.
 *
 * Only the step the run is actually waiting on is offered. Showing Accept,
 * Print and Ready together would mean reading three buttons to find the one
 * that does anything; the board's job is to make the next move obvious.
 */
export function StoreRunActions({
  runKey,
  counts,
  trainNo,
  delayMinutes,
  expectedArrival,
  delayThresholdMinutes,
  riders,
}: {
  runKey: string
  counts: Record<string, number>
  trainNo: string | null
  delayMinutes: number | null
  expectedArrival: string | null
  delayThresholdMinutes: number
  riders: { id: string; name: string }[]
}) {
  const [acceptState, accept, accepting] = useActionState(acceptRun, initial)
  const [readyState, ready, readying] = useActionState(markRunPrepared, initial)
  const [handState, hand, handing] = useActionState(handRunToRiderAction, initial)
  const [confirmingPrint, setConfirmingPrint] = useState(false)

  const toAccept = counts.RECEIVED ?? 0
  const toPrint = counts.ACCEPTED ?? 0
  const toReady = counts.KOT_PRINTED ?? 0
  const waiting = counts.PREPARED ?? 0

  // The delay guard asks, it never blocks: the system does not know how long
  // the dish keeps or how full the pass is.
  const late = shouldWarnAboutDelay(delayMinutes, delayThresholdMinutes)
  const printLabel = `Print ${toPrint} KOT${toPrint === 1 ? '' : 's'}`

  return (
    <div className="flex flex-wrap items-center gap-2">
      {toAccept > 0 ? (
        <form action={accept} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="runKey" value={runKey} />
          <Button type="submit" size="sm" pending={accepting}>
            Accept {toAccept}
          </Button>
          <FormNote state={acceptState} />
        </form>
      ) : null}

      {toPrint > 0 ? (
        <>
          <ButtonLink href={`/store/runs/${encodeURIComponent(runKey)}/kot`} variant="secondary" size="sm">
            Preview {toPrint} KOT{toPrint === 1 ? '' : 's'}
          </ButtonLink>
          {late ? (
            <Button type="button" size="sm" onClick={() => setConfirmingPrint(true)}>
              {printLabel}
            </Button>
          ) : (
            <form action={generateRunKot}>
              <input type="hidden" name="runKey" value={runKey} />
              <Button type="submit" size="sm">{printLabel}</Button>
            </form>
          )}
        </>
      ) : null}

      {toReady > 0 ? (
        <>
          <form action={ready} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="runKey" value={runKey} />
            <Button type="submit" size="sm" variant="go" pending={readying}>
              Mark {toReady} ready
            </Button>
            <FormNote state={readyState} />
          </form>
          <ButtonLink href={`/store/runs/${encodeURIComponent(runKey)}/kot`} variant="secondary" size="sm">
            Preview {toReady} KOT{toReady === 1 ? '' : 's'}
          </ButtonLink>
          <ReprintRunKotButton runKey={runKey} count={toReady} />
        </>
      ) : null}

      {/* Food is on the shelf. Either the rider marks it themselves in the app,
          or the manager hands it over here and names who took it. */}
      {waiting > 0 ? (
        riders.length > 0 ? (
          <form action={hand} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="runKey" value={runKey} />
            <label htmlFor={`rider-${runKey}`} className="text-xs font-medium text-emerald-700">
              {waiting} on the shelf. Hand to
            </label>
            <select
              id={`rider-${runKey}`}
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
            {waiting} on the shelf, and no active rider at this outlet.
          </span>
        )
      ) : null}

      {confirmingPrint ? (
        <ConfirmDialog
          titleId={`kot-delay-${runKey}`}
          title={<><span className="font-mono">{trainNo ?? 'This train'}</span> is running late</>}
          onCancel={() => setConfirmingPrint(false)}
          actions={
            <>
              <form action={generateRunKot} className="flex-1" onSubmit={() => setConfirmingPrint(false)}>
                <input type="hidden" name="runKey" value={runKey} />
                <Button type="submit" className="w-full">Print anyway</Button>
              </form>
              <Button type="button" variant="secondary" onClick={() => setConfirmingPrint(false)}>
                Wait
              </Button>
            </>
          }
        >
          Running <strong className="text-ink">{formatDelay(delayMinutes ?? 0)}</strong> late
          {expectedArrival ? (
            <>
              , now expected{' '}
              <strong className="tabular-nums text-ink">
                {new Date(expectedArrival).toLocaleTimeString('en-IN', {
                  timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true,
                })}
              </strong>
            </>
          ) : null}
          . Print {toPrint} KOT{toPrint === 1 ? '' : 's'} anyway? The food will sit until the train arrives.
        </ConfirmDialog>
      ) : null}
    </div>
  )
}
