'use client'

import { useActionState, useState, useTransition } from 'react'
import { Button, FormNote } from '@/components/ui'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import {
  acceptOrder, checkKotDelay, generateKot, markPrepared, type StoreActionState,
} from './actions'

const initial: StoreActionState = {}

export function AcceptButton({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState(acceptOrder, initial)
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="orderId" value={orderId} />
      <Button type="submit" pending={pending}>Accept</Button>
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
 * The delay guard asks, it does not block. The manager decides whether a late
 * train means the kitchen should wait.
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
        // A train-status outage must never block order flow. Fall through and print.
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
        pending={checking}
        variant={reprint ? 'secondary' : 'primary'}
      >
        {checking ? 'Checking the train' : reprint ? 'Reprint KOT' : 'Generate KOT'}
      </Button>

      {delay ? (
        <ConfirmDialog
          titleId={`kot-delay-${orderId}`}
          title={<><span className="font-mono">{delay.trainNo}</span> is running late</>}
          onCancel={() => setDelay(null)}
          actions={
            <>
              <form action={generateKot} className="flex-1" onSubmit={() => setDelay(null)}>
                <input type="hidden" name="orderId" value={orderId} />
                <Button type="submit" className="w-full">Print anyway</Button>
              </form>
              <Button type="button" variant="secondary" onClick={() => setDelay(null)}>
                Wait
              </Button>
            </>
          }
        >
          Running <strong className="text-ink">{formatDelay(delay.delayMinutes)}</strong> late
          {delay.expected ? (
            <>
              , now expected{' '}
              <strong className="tabular-nums text-ink">
                {new Date(delay.expected).toLocaleTimeString('en-IN', {
                  timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true,
                })}
              </strong>
            </>
          ) : null}
          . Print the KOT anyway?
        </ConfirmDialog>
      ) : null}
    </>
  )
}

export function MarkPreparedButton({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState(markPrepared, initial)
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="orderId" value={orderId} />
      <Button type="submit" variant="go" pending={pending}>Mark ready</Button>
      <FormNote state={state} />
    </form>
  )
}
