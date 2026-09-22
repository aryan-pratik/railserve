'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatTimeIST } from '@/lib/format'
import { IconAlert, IconClose } from './Icons'
import { focusRing } from './ui'

export type Cancellation = {
  id: string
  externalOrderId: string
  trainNo: string | null
  coach: string | null
  berth: string | null
  rawSeat: string | null
  contactName: string | null
  stationCode: string
  /** Which alert-worthy status this order was moved to. */
  status: string
  cancelledAt: string
  by: string
  reason: string | null
}

/** The headline per status this alert can fire for. */
const HEADLINE: Record<string, string> = {
  CANCELLED: 'Cancelled: do not cook or dispatch',
  MISDELIVERY: 'Misdelivery: reached the wrong seat or passenger',
  MISSED_DELIVERY: 'Missed delivery: never reached the passenger',
  REFUNDED: 'Refunded',
  RATING_ORDER: 'Flagged as a rating order, not a real order',
}

/** Dismissals survive a reload; a banner that comes back after "Got it" is noise. */
const ACK_KEY = 'railserve.cancellationsAcked'
const ACK_LIMIT = 100

/** Older than this on arrival and it is history, not news — show it, silently. */
const CHIME_WINDOW_MS = 5 * 60_000

/** How many alerts stack before the rest collapse into a count. */
const MAX_VISIBLE = 3

/** No frame for this long means the stream is open but not delivering. */
const STALE_MS = 20_000
const FALLBACK_TICK_MS = 10_000

function readAcked(): string[] {
  try {
    const raw = localStorage.getItem(ACK_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    // Private window, blocked storage, corrupt value — none of which is a
    // reason to withhold the alert. Nothing dismissed is the safe reading.
    return []
  }
}

function writeAcked(ids: string[]) {
  try {
    localStorage.setItem(ACK_KEY, JSON.stringify(ids.slice(-ACK_LIMIT)))
  } catch {
    // Dismissal then lasts for this page view only. Still better than nothing.
  }
}

/**
 * Says out loud that an order's status just changed to one a manager needs
 * to react to: cancelled, misdelivered, missed, refunded, or flagged as a
 * decoy rating order.
 *
 * The problem this solves is a specific one. A telecaller rings a passenger,
 * something goes wrong, and until now that news travelled by WhatsApp — where
 * it gets missed, the kitchen cooks the food anyway and a rider carries it to
 * a train nobody is waiting on it from. Or, on the other three statuses,
 * nobody but the telecaller who made the change ever finds out at all. Moving
 * the order off the live pipeline is only half a fix, because it drops out of
 * LIVE_STATUSES and therefore *disappears* from the board: the one signal a
 * busy manager gets is a card quietly ceasing to exist.
 *
 * So it is loud on purpose — red, a bell, and a buzz on a phone, staying until
 * it is dismissed. Loud, but small: a corner stack of at most three one-line
 * cards, because the first version ran the full width of the screen and grew
 * with every outstanding cancellation, and an alert that buries the board it
 * is warning about has defeated itself. Anything past three collapses into a
 * count.
 *
 * It sits in the store and agent layouts rather than on one page, because the
 * manager may be anywhere in their section when it happens.
 *
 * Reliability matters more than elegance here, so there are two paths to the
 * same data: the SSE stream, and a poll that takes over whenever the stream
 * stops delivering — including the silent case where a proxy holds the
 * connection open and buffers every frame. A tab that was asleep re-checks the
 * moment it is looked at again.
 */
export function CancellationAlert() {
  const router = useRouter()
  const [items, setItems] = useState<Cancellation[]>([])
  const [acked, setAcked] = useState<string[]>([])

  const knownRef = useRef<Set<string> | null>(null)
  const lastMessageRef = useRef(0)
  const audioRef = useRef<AudioContext | null>(null)
  // Read through a ref inside `apply`, not as a dependency: dismissing one
  // banner must not tear down and re-open the stream. `null` means the stored
  // dismissals have not been loaded yet — see the first-payload branch below,
  // which is where localStorage is read. Doing it there rather than in an
  // effect keeps it out of the render path entirely: there is nothing to
  // display until a payload arrives anyway.
  const ackedRef = useRef<string[] | null>(null)

  // Browsers refuse to make noise until the page has been interacted with.
  // A kitchen screen gets touched; the first touch is all this needs.
  useEffect(() => {
    const unlock = () => {
      if (audioRef.current) return
      try {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (Ctor) audioRef.current = new Ctor()
      } catch {
        // No audio on this device. The banner is the primary channel anyway.
      }
    }
    const opts = { once: true, passive: true } as const
    document.addEventListener('pointerdown', unlock, opts)
    document.addEventListener('keydown', unlock, opts)
    return () => {
      document.removeEventListener('pointerdown', unlock)
      document.removeEventListener('keydown', unlock)
    }
  }, [])

  const apply = useCallback(
    (next: Cancellation[]) => {
      lastMessageRef.current = Date.now()

      if (ackedRef.current === null) {
        const stored = readAcked()
        ackedRef.current = stored
        if (stored.length > 0) setAcked(stored)
      }
      const alreadyAcked = ackedRef.current

      const known = knownRef.current
      const ids = new Set(next.map((c) => c.id))

      // First payload of this page view: adopt it without announcing. Anything
      // genuinely fresh still chimes, via the age check below.
      const fresh = next.filter((c) => !known || !known.has(c.id))
      knownRef.current = ids

      setItems((prev) => {
        // Same set, same order — do not re-render or re-refresh.
        if (prev.length === next.length && prev.every((p, i) => p.id === next[i].id)) return prev
        return next
      })

      if (fresh.length === 0) return

      const now = Date.now()
      const loud = fresh.some(
        (c) =>
          now - new Date(c.cancelledAt).getTime() < CHIME_WINDOW_MS &&
          !alreadyAcked.includes(c.id),
      )
      if (loud) {
        chime(audioRef)
        try {
          navigator.vibrate?.([180, 90, 180])
        } catch {
          // Unsupported or blocked. Not worth a thought.
        }
      }

      // The board below is still showing the order as live work. Only refresh
      // when the set actually moved, or this would loop on every tick.
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
      // EventSource reconnects on its own; the staleness check decides whether
      // to start polling in the meantime.
    }

    // The safety net: runs only while the stream is not delivering, so a
    // healthy connection costs nothing.
    const fallback = setInterval(() => {
      if (Date.now() - lastMessageRef.current > STALE_MS) void poll()
    }, FALLBACK_TICK_MS)

    // A tab that was in the background may have had its timers throttled to
    // nothing. Re-check the instant somebody looks at it again.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastMessageRef.current > STALE_MS) {
        void poll()
      }
    }
    document.addEventListener('visibilitychange', onVisible)

    // Nothing has arrived yet, so the stream has not proved itself.
    void poll()

    return () => {
      cancelled = true
      clearInterval(fallback)
      document.removeEventListener('visibilitychange', onVisible)
      source.close()
    }
  }, [apply])

  function dismiss(id: string) {
    const prev = ackedRef.current ?? []
    if (prev.includes(id)) return
    const next = [...prev, id]
    ackedRef.current = next
    writeAcked(next)
    setAcked(next)
  }

  const showing = items.filter((c) => !acked.includes(c.id))
  if (showing.length === 0) return null

  // Newest first, and only a few. This used to render every outstanding
  // cancellation as a full-width card across the bottom of the screen, which
  // on a busy afternoon meant the board it was warning about was the one thing
  // you could no longer see. A stack that buries the work is a worse alert.
  const visible = showing.slice(-MAX_VISIBLE).reverse()
  const hidden = showing.length - visible.length

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="no-print fixed inset-x-3 bottom-3 z-40 space-y-2 sm:inset-x-auto sm:right-4 sm:w-[23rem]"
    >
      {visible.map((c) => (
        <div
          key={c.id}
          className="flex items-start gap-2.5 rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 shadow-lg"
        >
          <IconAlert size={16} className="mt-0.5 shrink-0 text-red-600" aria-hidden />

          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-red-900">{HEADLINE[c.status] ?? 'Status changed'}</p>
            <p className="truncate text-xs text-red-900">
              <span className="font-mono font-semibold">{c.externalOrderId}</span>
              {c.trainNo ? ` · ${c.trainNo}` : ''}
              {seatOf(c) ? ` · ${seatOf(c)}` : ''}
            </p>
            {/* One line, with the full sentence on hover: a reason long
                enough to wrap is exactly what made these cards so tall. */}
            {c.reason ? (
              <p className="truncate text-xs text-red-700" title={c.reason}>
                &ldquo;{c.reason}&rdquo;
              </p>
            ) : null}
            <p className="truncate text-[11px] text-red-700/90">
              {c.by} · {formatTimeIST(c.cancelledAt)}
            </p>
          </div>

          <button
            type="button"
            onClick={() => dismiss(c.id)}
            aria-label={`Dismiss the alert for ${c.externalOrderId}`}
            title="Got it"
            className={`-mr-1 -mt-0.5 shrink-0 rounded p-2 text-red-700 transition-colors hover:bg-red-100 sm:p-1 ${focusRing}`}
          >
            <IconClose size={14} aria-hidden />
          </button>
        </div>
      ))}

      {hidden > 0 ? (
        <p className="rounded-lg border border-red-200 bg-red-50/90 px-3 py-1.5 text-center text-[11px] font-medium text-red-800 shadow-sm">
          and {hidden} more changed: check the board
        </p>
      ) : null}
    </div>
  )
}

function seatOf(c: Cancellation): string | null {
  if (c.coach) return `${c.coach}${c.berth ? ` ${c.berth}` : ''}`
  return c.rawSeat ?? null
}

/**
 * A struck bell, generated rather than shipped as an asset.
 *
 * This was a square wave to begin with, which is the timbre of an alarm clock:
 * it read as "something is broken" when the instruction is only "stop cooking
 * that one". A real bell is not one frequency but a stack of inharmonic
 * partials over a long decay, so that is what this builds. Two strikes, the
 * second a fourth below the first, which is the doorbell interval a restaurant
 * floor already recognises.
 *
 * Pitched apart from OrderFeed's rising new-order chime, so one screen's two
 * sounds cannot be mistaken for one another.
 */
function chime(ref: React.RefObject<AudioContext | null>) {
  const ctx = ref.current
  if (!ctx) return
  const now = ctx.currentTime

  // Ratios of a struck bell rather than a harmonic series. The 2.4 is what
  // stops it sounding like an organ pipe.
  const partials: [number, number, number][] = [
    [1, 0.16, 1.7],
    [2, 0.05, 1.2],
    [2.4, 0.035, 0.9],
    [3, 0.02, 0.6],
  ]

  for (const { freq, at } of [
    { freq: 880, at: 0 },
    { freq: 659.25, at: 0.3 },
  ]) {
    for (const [multiple, peak, seconds] of partials) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq * multiple

      const t = now + at
      // A near-instant attack is what makes it read as struck rather than
      // blown; the long tail is what makes it read as metal.
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(peak, t + 0.005)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds)

      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + seconds + 0.05)
    }
  }
}
