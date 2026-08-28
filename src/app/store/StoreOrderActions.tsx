'use client'

import { useActionState, useState, useTransition } from 'react'
import { Button, FormNote } from '@/components/ui'
import {
  acceptOrder, checkKotDelay, generateKot, markPrepared, type StoreActionState,
} from './actions'

const initial: StoreActionState = {}

export function AcceptButton({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState(acceptOrder, initial)
  return (
    <form action={action}>
      <input type="hidden" name="orderId" value={orderId} />
      <Button type="submit" disabled={pending}>
        {pending ? 'Accepting…' : 'Accept'}
      </Button>
      <FormNote state={state} />
    </form>
  )
}

type DelayInfo = Awaited<ReturnType<typeof checkKotDelay>>

function formatDelay(minutes: number | null): string {
  if (minutes === null) return 'an unknown amount'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/**
 * Plan §9: the delay guard asks, it does not block. The manager decides whether
 * a late train means the kitchen should wait — the system has no idea how long
 * the dish keeps, or how full the pass is.
 */
export function GenerateKotButton({ orderId, reprint }: { orderId: string; reprint?: boolean }) {
  const [checking, startChecking] = useTransition()
  const [delay, setDelay] = useState<DelayInfo | null>(null)

  function onClick() {
    startChecking(async () => {
      try {
        const info = await checkKotDelay(orderId)
        if (info.delayed) {
          setDelay(info)
          return
        }
      } catch {
        // A train-status outage must never block order flow (plan §13.6).
        // Fall through and print.
      }
      const fd = new FormData()
      fd.set('orderId', orderId)
      await generateKot(fd)
    })
  }

  return (
    <>
      <Button
        type="button"
        onClick={onClick}
        disabled={checking}
        variant={reprint ? 'secondary' : 'primary'}
      >
        {checking ? 'Checking train…' : reprint ? 'Reprint KOT' : 'Generate KOT'}
      </Button>

      {delay ? (
        <div
          role="alertdialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
        >
          <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-5 shadow-xl">
            <h3 className="text-base font-semibold text-ink">
              <span className="font-mono">{delay.trainNo}</span> is running late
            </h3>
            <p className="mt-2 text-sm text-muted">
              Running <strong className="text-ink">{formatDelay(delay.delayMinutes)}</strong> late
              {delay.expected ? (
                <>
                  , expected{' '}
                  <strong className="text-ink tabular-nums">
                    {new Date(delay.expected).toLocaleTimeString('en-IN', {
                      timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true,
                    })}
                  </strong>
                </>
              ) : null}
              . Print the KOT anyway?
            </p>
            <div className="mt-4 flex gap-2">
              <form action={generateKot} className="flex-1" onSubmit={() => setDelay(null)}>
                <input type="hidden" name="orderId" value={orderId} />
                <Button type="submit" className="w-full">Print anyway</Button>
              </form>
              <Button type="button" variant="secondary" onClick={() => setDelay(null)}>
                Wait
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

export function MarkPreparedButton({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState(markPrepared, initial)
  return (
    <form action={action}>
      <input type="hidden" name="orderId" value={orderId} />
      <Button type="submit" variant="go" disabled={pending}>
        {pending ? 'Saving…' : 'Mark ready'}
      </Button>
      <FormNote state={state} />
    </form>
  )
}
