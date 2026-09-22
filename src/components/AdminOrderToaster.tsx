'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { IconAlert, IconClose } from './Icons'
import { focusRing } from './ui'
import type { Cancellation } from './CancellationAlert'

/** The headline per status this toaster can fire for. */
const HEADLINE: Record<string, string> = {
  CANCELLED: 'Cancelled',
  MISDELIVERY: 'Misdelivery: reached the wrong seat or passenger',
  MISSED_DELIVERY: 'Missed delivery: never reached the passenger',
  REFUNDED: 'Refunded',
  RATING_ORDER: 'Flagged as a rating order, not a real order',
}

/** A toast clears itself after this long, unless dismissed sooner. */
const AUTO_DISMISS_MS = 8_000

/** No frame for this long means the stream is open but not delivering. */
const STALE_MS = 20_000
const FALLBACK_TICK_MS = 10_000

type Toast = Cancellation & { expiresAt: number }

/**
 * A quiet, self-clearing notice for admin when a telecaller changes an
 * order's status (cancelled, misdelivered, missed, refunded, or flagged as
 * a rating order).
 *
 * An admin isn't standing over a stove, so the loud, stays-until-dismissed
 * banner `CancellationAlert` uses for store and delivery-agent screens is
 * the wrong register here: no bell, no vibration, no fixed corner stack an
 * admin has to keep clicking "got it" on. A toast that appears, is readable
 * for a few seconds, and clears itself is enough.
 *
 * Same data source as `CancellationAlert` (the SSE feed already open to
 * ADMIN), just presented differently: each toast lives for `AUTO_DISMISS_MS`
 * and is then dropped, rather than persisted through localStorage.
 */
export function AdminOrderToaster() {
  const router = useRouter()
  const [toasts, setToasts] = useState<Toast[]>([])

  const knownRef = useRef<Set<string> | null>(null)
  const lastMessageRef = useRef(0)

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const apply = useCallback(
    (next: Cancellation[]) => {
      lastMessageRef.current = Date.now()

      const known = knownRef.current
      const ids = new Set(next.map((c) => c.id))

      // First payload of this page view: adopt the set without toasting for
      // any of it. Only a change seen after that counts as news.
      const fresh = known ? next.filter((c) => !known.has(c.id)) : []
      knownRef.current = ids

      if (fresh.length > 0) {
        const expiresAt = Date.now() + AUTO_DISMISS_MS
        setToasts((prev) => [...prev, ...fresh.map((c) => ({ ...c, expiresAt }))])
      }

      // The order list below is still showing the old status. Only refresh
      // once the known set has actually moved, so this can't loop forever.
      if (known) router.refresh()
    },
    [router],
  )

  useEffect(() => {
    let cancelled = false

    const poll = async () => {
      try {
        const res = await fetch('/api/store/cancellations?poll=1', { cache: 'no-store' })
        if (!res.ok) return
        const body = (await res.json()) as { cancellations?: Cancellation[] }
        if (!cancelled && Array.isArray(body.cancellations)) apply(body.cancellations)
      } catch {
        // Offline, or the request was cut short. The next tick tries again.
      }
    }

    const source = new EventSource('/api/store/cancellations')
    const onData = (e: Event) => {
      lastMessageRef.current = Date.now()
      try {
        const body = JSON.parse((e as MessageEvent).data) as { cancellations?: Cancellation[] }
        if (Array.isArray(body.cancellations)) apply(body.cancellations)
      } catch {
        // Malformed frame. The fallback below covers a stream that keeps
        // producing them.
      }
    }
    source.addEventListener('snapshot', onData)
    source.addEventListener('change', onData)
    source.addEventListener('ping', () => {
      lastMessageRef.current = Date.now()
    })
    source.onerror = () => {
      // EventSource reconnects on its own; the staleness check decides
      // whether to start polling in the meantime.
    }

    const fallback = setInterval(() => {
      if (Date.now() - lastMessageRef.current > STALE_MS) void poll()
    }, FALLBACK_TICK_MS)

    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastMessageRef.current > STALE_MS) {
        void poll()
      }
    }
    document.addEventListener('visibilitychange', onVisible)

    void poll()

    return () => {
      cancelled = true
      clearInterval(fallback)
      document.removeEventListener('visibilitychange', onVisible)
      source.close()
    }
  }, [apply])

  // One tick a second is enough to clear an expired toast without a timer
  // per toast to clean up.
  useEffect(() => {
    if (toasts.length === 0) return
    const tick = setInterval(() => {
      const now = Date.now()
      setToasts((prev) => prev.filter((t) => t.expiresAt > now))
    }, 1000)
    return () => clearInterval(tick)
  }, [toasts.length])

  if (toasts.length === 0) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="no-print fixed inset-x-3 top-3 z-40 space-y-2 sm:inset-x-auto sm:right-4 sm:w-[22rem]"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="flex items-start gap-2.5 rounded-lg border border-line-strong bg-surface px-3 py-2.5 shadow-lg"
        >
          <IconAlert size={15} className="mt-0.5 shrink-0 text-amber-600" aria-hidden />

          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-ink">{HEADLINE[t.status] ?? 'Status changed'}</p>
            <p className="truncate text-xs text-muted">
              <span className="font-mono font-semibold text-ink">{t.externalOrderId}</span>
              {t.trainNo ? ` · ${t.trainNo}` : ''}
              {seatOf(t) ? ` · ${seatOf(t)}` : ''}
            </p>
            {t.reason ? (
              <p className="truncate text-xs text-faint" title={t.reason}>
                &ldquo;{t.reason}&rdquo;
              </p>
            ) : null}
            <p className="truncate text-[11px] text-faint">{t.by}</p>
          </div>

          <button
            type="button"
            onClick={() => dismiss(t.id)}
            aria-label={`Dismiss the notice for ${t.externalOrderId}`}
            className={`-mr-1 -mt-0.5 shrink-0 rounded p-2 text-faint transition-colors hover:bg-sunken sm:p-1 ${focusRing}`}
          >
            <IconClose size={14} aria-hidden />
          </button>
        </div>
      ))}
    </div>
  )
}

function seatOf(c: Cancellation): string | null {
  if (c.coach) return `${c.coach}${c.berth ? ` ${c.berth}` : ''}`
  return c.rawSeat ?? null
}
