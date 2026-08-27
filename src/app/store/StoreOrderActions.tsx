'use client'

import { useActionState, useState, useTransition } from 'react'
import {
  acceptOrder, checkKotDelay, generateKot, markPrepared, type StoreActionState,
} from './actions'

const initial: StoreActionState = {}

function Feedback({ state }: { state: StoreActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="mt-2 text-xs font-medium text-red-600">
        {state.error}
      </p>
    )
  }
  return null
}

export function AcceptButton({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState(acceptOrder, initial)
  return (
    <form action={action}>
      <input type="hidden" name="orderId" value={orderId} />
      <button type="submit" disabled={pending}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
        {pending ? 'Accepting…' : 'Accept'}
      </button>
      <Feedback state={state} />
    </form>
  )
}

type DelayInfo = Awaited<ReturnType<typeof checkKotDelay>>

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

  const className = reprint
    ? 'rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50'
    : 'rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50'

  return (
    <>
      <button type="button" onClick={onClick} disabled={checking} className={className}>
        {checking ? 'Checking train…' : reprint ? 'Reprint KOT' : 'Generate KOT'}
      </button>

      {delay ? (
        <div
          role="alertdialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900">
              {delay.trainNo} is running late
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              Running <strong>{formatDelay(delay.delayMinutes)}</strong> late
              {delay.expected ? (
                <>
                  , expected{' '}
                  <strong>
                    {new Date(delay.expected).toLocaleTimeString('en-IN', {
                      timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true,
                    })}
                  </strong>
                </>
              ) : null}
              . Print the KOT anyway?
            </p>
            <div className="mt-4 flex gap-2">
              <form
                action={generateKot}
                className="flex-1"
                onSubmit={() => setDelay(null)}
              >
                <input type="hidden" name="orderId" value={orderId} />
                <button type="submit"
                  className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800">
                  Print anyway
                </button>
              </form>
              <button type="button" onClick={() => setDelay(null)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Wait
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

function formatDelay(minutes: number | null): string {
  if (minutes === null) return 'an unknown amount'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function MarkPreparedButton({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState(markPrepared, initial)
  return (
    <form action={action}>
      <input type="hidden" name="orderId" value={orderId} />
      <button type="submit" disabled={pending}
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
        {pending ? 'Saving…' : 'Mark prepared'}
      </button>
      <Feedback state={state} />
    </form>
  )
}
