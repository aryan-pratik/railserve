'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { formatTimeIST } from '@/lib/format'
import { Mono, cx, v2Focus } from './ui'

export type KitchenCancellation = {
  id: string
  externalOrderId: string
  trainNo: string | null
  coach: string | null
  berth: string | null
  rawSeat: string | null
  contactName: string | null
  stationCode: string
  status: string
  cancelledAt: string
  by: string
  reason: string | null
}

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
/** Older than this on arrival and it is history, not news: shown silently. */
const CHIME_WINDOW_MS = 5 * 60_000
const MAX_VISIBLE = 3
/** No frame for this long means the stream is open but not delivering. */
const STALE_MS = 20_000
const FALLBACK_TICK_MS = 10_000

function readAcked(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(ACK_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}
function writeAcked(ids: string[]) {
  try {
    localStorage.setItem(ACK_KEY, JSON.stringify(ids.slice(-ACK_LIMIT)))
  } catch {
    // Dismissal lasts for this page view only.
  }
}

/**
 * Says out loud that an order just left the live pipeline for a reason the
 * kitchen must react to. Moving it off LIVE_STATUSES makes it vanish from
 * the board, and a card quietly ceasing to exist is not a "stop cooking".
 *
 * Two paths to the same data: the SSE stream, and a poll that takes over
 * whenever the stream stops delivering. Newest change on top, at most three,
 * the rest as a count; each stays until "Got it".
 */
export function KitchenCancellations() {
  const router = useRouter()
  const [items, setItems] = useState<KitchenCancellation[]>([])
  const [acked, setAcked] = useState<string[]>([])
  const knownRef = useRef<Set<string> | null>(null)
  const lastMessageRef = useRef(0)
  const audioRef = useRef<AudioContext | null>(null)
  // Read through a ref inside `apply`: dismissing one banner must not tear
  // down and reopen the stream. Null until the first payload loads them.
  const ackedRef = useRef<string[] | null>(null)

  useEffect(() => {
    const unlock = () => {
      if (audioRef.current) return
      try {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
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
    (next: KitchenCancellation[]) => {
      lastMessageRef.current = Date.now()
      if (ackedRef.current === null) {
        const stored = readAcked()
        ackedRef.current = stored
        if (stored.length > 0) setAcked(stored)
      }
      const alreadyAcked = ackedRef.current
      const known = knownRef.current
      // First payload of this page view: adopt without announcing. Anything
      // genuinely fresh still chimes, via the age check below.
      const fresh = next.filter((c) => !known || !known.has(c.id))
      knownRef.current = new Set(next.map((c) => c.id))

      setItems((prev) => (prev.length === next.length && prev.every((p, i) => p.id === next[i].id) ? prev : next))
      if (fresh.length === 0) return

      const now = Date.now()
      if (fresh.some((c) => now - new Date(c.cancelledAt).getTime() < CHIME_WINDOW_MS && !alreadyAcked.includes(c.id))) {
        bell(audioRef.current)
        try {
          navigator.vibrate?.([180, 90, 180])
        } catch {
          // Unsupported. Not worth a thought.
        }
      }
      // The board is still showing the order as live work; refresh only when
      // the set actually moved, or this would loop on every tick.
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
        const body = (await res.json()) as { cancellations?: KitchenCancellation[] }
        if (!cancelled && Array.isArray(body.cancellations)) apply(body.cancellations)
      } catch {
        // Offline, or cut short. The next tick tries again.
      }
    }
    const source = new EventSource('/api/store/cancellations')
    const onData = (e: Event) => {
      lastMessageRef.current = Date.now()
      try {
        const body = JSON.parse((e as MessageEvent).data) as { cancellations?: KitchenCancellation[] }
        if (Array.isArray(body.cancellations)) apply(body.cancellations)
      } catch {
        // Malformed frame; the fallback covers a stream that keeps producing them.
      }
    }
    source.addEventListener('snapshot', onData)
    source.addEventListener('change', onData)
    source.addEventListener('ping', () => {
      lastMessageRef.current = Date.now()
    })
    const fallback = setInterval(() => {
      if (Date.now() - lastMessageRef.current > STALE_MS) void poll()
    }, FALLBACK_TICK_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastMessageRef.current > STALE_MS) void poll()
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

  function dismiss(id: string) {
    const prev = ackedRef.current ?? []
    if (prev.includes(id)) return
    const next = [...prev, id]
    ackedRef.current = next
    writeAcked(next)
    setAcked(next)
  }

  // Newest first, whatever order the feed sent them in: the latest change is
  // the one most likely to still be cooking.
  const showing = items
    .filter((c) => !acked.includes(c.id))
    .sort((a, b) => Date.parse(b.cancelledAt) - Date.parse(a.cancelledAt))
  if (showing.length === 0) return null
  const visible = showing.slice(0, MAX_VISIBLE)
  const hidden = showing.length - visible.length

  return (
    <div role="alert" aria-live="assertive" className="fixed inset-x-3 bottom-3 z-[60] grid gap-2 sm:inset-x-auto sm:right-4 sm:w-[24rem]">
      {visible.map((c) => (
        <div key={c.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2.5 rounded-v2-lg border border-v2-bad/40 bg-v2-bad-bg px-3.5 py-3 shadow-v2-pop">
          <AlertTriangle size={16} className="mt-0.5 text-v2-bad" aria-hidden />
          <div className="min-w-0 text-v2-bad">
            <p className="text-[13px] font-bold">{HEADLINE[c.status] ?? 'Status changed'}</p>
            <p className="truncate text-xs">
              <Mono className="font-semibold">{c.externalOrderId}</Mono>
              {c.trainNo ? (
                <>
                  {' · '}
                  <Mono>{c.trainNo}</Mono>
                </>
              ) : null}
              {seatOf(c) ? (
                <>
                  {' · '}
                  <Mono>{seatOf(c)}</Mono>
                </>
              ) : null}
              {c.contactName ? ` · ${c.contactName}` : ''}
            </p>
            {c.reason ? (
              <p className="truncate text-xs opacity-90" title={c.reason}>
                &ldquo;{c.reason}&rdquo;
              </p>
            ) : null}
            <p className="truncate text-[11px] opacity-80">
              {c.by} · {formatTimeIST(c.cancelledAt)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => dismiss(c.id)}
            className={cx('h-8 shrink-0 rounded-full border border-v2-bad/40 px-3 text-xs font-bold text-v2-bad hover:bg-v2-bad hover:text-white', v2Focus)}
            aria-label={`Got it: dismiss the alert for ${c.externalOrderId}`}
          >
            Got it
          </button>
        </div>
      ))}
      {hidden > 0 ? (
        <p className="rounded-v2-md border border-v2-bad/30 bg-v2-bad-bg/95 px-3 py-1.5 text-center text-[11px] font-semibold text-v2-bad shadow-v2-pop">
          and {hidden} more changed: check the board
        </p>
      ) : null}
    </div>
  )
}

function seatOf(c: KitchenCancellation): string | null {
  if (c.coach) return `${c.coach}${c.berth ? `·${c.berth}` : ''}`
  return c.rawSeat ?? null
}

/**
 * A struck bell: two strikes, the second a fourth below. Pitched apart from
 * the new-order chime so the two sounds cannot be mistaken for one another.
 */
function bell(ctx: AudioContext | null) {
  if (!ctx) return
  const now = ctx.currentTime
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
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(peak, t + 0.005)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + seconds + 0.05)
    }
  }
}
