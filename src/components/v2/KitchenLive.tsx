'use client'

import { reportIssue } from './statusBus'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { Volume2, VolumeX } from 'lucide-react'
import { useNowMs } from '@/components/useNow'
import { REFRESH_SECONDS } from '@/lib/liveDay'
import { cx, v2Focus } from './ui'

/*
 * What keeps the kitchen board current.
 *
 * Two channels to the same end: the SSE count stream (`/api/store/stream`)
 * refreshes the page the moment the scoped counts move and chimes when the
 * RECEIVED count rose; a 30s router.refresh underneath it moves a late
 * train's new ETA onto the screen even when no order changed, and covers a
 * proxy that holds the stream open and never delivers. There is no pause: a
 * paused board is indistinguishable from a quiet one.
 */

/** A screen this many refresh cycles old is no longer showing current data. */
const STALE_AFTER_CYCLES = 2

/*
 * The ring on a new order is always on. Muting it only pauses it, for at
 * most PAUSE_MS, then it rings again by itself: a kitchen screen left muted
 * is how a new order sits unseen. The pause end is shared by every tab.
 */
const PAUSE_KEY = 'railserve.v2.kitchenPausedUntil'
const PAUSE_MS = 5 * 60_000
const soundListeners = new Set<() => void>()

function readPause(): number {
  try {
    return Number(localStorage.getItem(PAUSE_KEY)) || 0
  } catch {
    return 0
  }
}
function writePause(until: number) {
  try {
    localStorage.setItem(PAUSE_KEY, String(until))
  } catch {
    // Then it is remembered for this page view only.
  }
  for (const l of soundListeners) l()
}
function subscribeSound(cb: () => void) {
  soundListeners.add(cb)
  window.addEventListener('storage', cb)
  return () => {
    soundListeners.delete(cb)
    window.removeEventListener('storage', cb)
  }
}
const serverPause = () => 0

/** "4:32" left on a pause. */
function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function stamp(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })
}

/**
 * Staleness is read off the server's render time rather than off whether
 * router.refresh() threw: that call reports nothing. What does change on
 * every good refresh is `renderedAt`, so a stamp that stopped moving is
 * stale, whatever the reason.
 */
function useStale(renderedAt: string, seconds: number): boolean {
  const nowMs = useNowMs(5_000)
  if (nowMs === null) return false
  return nowMs - new Date(renderedAt).getTime() > seconds * STALE_AFTER_CYCLES * 1000
}

function makeAudio(): AudioContext | null {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    return Ctor ? new Ctor() : null
  } catch {
    return null
  }
}

/** A rising two-note chime: generated, so a kitchen screen needs no asset. */
function chime(ctx: AudioContext | null) {
  if (!ctx) return
  const now = ctx.currentTime
  for (const [i, freq] of [880, 1320].entries()) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = freq
    osc.type = 'sine'
    gain.gain.setValueAtTime(0.0001, now + i * 0.18)
    gain.gain.exponentialRampToValueAtTime(0.25, now + i * 0.18 + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.35)
    osc.connect(gain).connect(ctx.destination)
    osc.start(now + i * 0.18)
    osc.stop(now + i * 0.18 + 0.4)
  }
}

export function KitchenLive({
  renderedAt,
  seconds = REFRESH_SECONDS,
  dark = false,
  compact = false,
}: {
  renderedAt: string
  seconds?: number
  /** Icon only: the screen's header has no room for words that rarely change. */
  compact?: boolean
  /** On the wall: light text on the dark board. */
  dark?: boolean
}) {
  const router = useRouter()
  const stale = useStale(renderedAt, seconds)
  const pausedUntil = useSyncExternalStore(subscribeSound, readPause, serverPause)
  // Ticks once a second while paused, so the countdown moves and the ring
  // comes back on by itself the moment the pause runs out.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (pausedUntil <= Date.now()) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [pausedUntil])
  const paused = pausedUntil > now
  // Browsers stay silent until the page has been touched once.
  const [unlocked, setUnlocked] = useState(false)
  const [connected, setConnected] = useState(false)
  const [lastEvent, setLastEvent] = useState<string | null>(null)
  const audioRef = useRef<AudioContext | null>(null)

  // Browsers refuse to make noise until the page has been touched. With
  // sound remembered on, the first touch of the page is the unlock.
  useEffect(() => {
    const unlock = () => {
      if (!audioRef.current) audioRef.current = makeAudio()
      if (audioRef.current) setUnlocked(true)
    }
    const opts = { passive: true } as const
    document.addEventListener('pointerdown', unlock, opts)
    document.addEventListener('keydown', unlock, opts)
    return () => {
      document.removeEventListener('pointerdown', unlock)
      document.removeEventListener('keydown', unlock)
    }
  }, [])

  useEffect(() => {
    const es = new EventSource('/api/store/stream')
    es.addEventListener('snapshot', () => setConnected(true))
    es.addEventListener('ping', () => setConnected(true))
    es.addEventListener('change', (e) => {
      setConnected(true)
      let newOrders = 0
      try {
        newOrders = JSON.parse((e as MessageEvent).data).newOrders ?? 0
      } catch {
        // Malformed frame: still refresh, just do not chime.
      }
      if (newOrders > 0) {
        setLastEvent(`${newOrders} new order${newOrders === 1 ? '' : 's'}`)
        // Read the pause fresh: the countdown state may lag by a second.
        if (readPause() <= Date.now()) chime(audioRef.current)
      }
      router.refresh()
    })
    es.onerror = () => setConnected(false)
    return () => es.close()
  }, [router])

  useEffect(() => {
    const t = setInterval(() => router.refresh(), seconds * 1000)
    // A background tab's timers are throttled; refresh the moment it is
    // looked at again, and the moment the network returns.
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') router.refresh()
    }
    document.addEventListener('visibilitychange', refreshIfVisible)
    window.addEventListener('online', refreshIfVisible)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', refreshIfVisible)
      window.removeEventListener('online', refreshIfVisible)
    }
  }, [router, seconds])

  // On: pause for five minutes. Paused, or not yet allowed to make sound:
  // ring now (the tap is the gesture the browser wants) and stay on.
  const toggleSound = useCallback(() => {
    if (!audioRef.current) audioRef.current = makeAudio()
    if (audioRef.current) setUnlocked(true)
    if (readPause() > Date.now() || !unlocked) {
      writePause(0)
      chime(audioRef.current)
    } else {
      writePause(Date.now() + PAUSE_MS)
    }
  }, [unlocked])

  const muted = dark ? 'text-white/70' : 'text-v2-muted'
  // Three states: ringing; paused, with the time left; or not yet allowed to
  // make sound, which needs one tap on the page.
  const state: 'needsTap' | 'paused' | 'on' = !unlocked ? 'needsTap' : paused ? 'paused' : 'on'
  const left = mmss(pausedUntil - now)
  const words =
    state === 'needsTap' ? 'Tap to turn on the ring' : state === 'paused' ? `Ring paused · ${left}` : 'Ring on new order'
  const hint =
    state === 'needsTap'
      ? 'The browser stays silent until the page is tapped once. Tap here so new orders ring.'
      : state === 'paused'
        ? `Paused for ${left} more. Tap to ring again now.`
        : 'Rings on every new order. Tap to pause for 5 minutes.'
  if (compact) {
    // Quiet when all is well: only the bell. A problem shows as words, since
    // that is the one time somebody needs to read it.
    return (
      <div className="flex items-center gap-2 text-xs font-semibold">
        {stale || !connected ? (
          <span className={cx('inline-flex items-center gap-1.5', stale ? 'text-v2-urgent' : 'text-v2-soon')}>
            <span aria-hidden className={cx('inline-block h-2 w-2 rounded-full', stale ? 'bg-v2-urgent' : 'bg-v2-soon')} />
            {stale ? 'Not updating, refresh the page' : 'Reconnecting…'}
          </span>
        ) : null}
        <button
          type="button"
          onClick={toggleSound}
          aria-pressed={state === 'on'}
          aria-label={`${words}. ${hint}`}
          title={hint}
          className={cx(
            'inline-flex h-10 items-center justify-center gap-1.5 rounded-full border transition-colors',
            state === 'on' ? 'w-10 border-v2-brand bg-v2-brand-soft text-v2-brand' : 'px-3',
            state === 'paused' && 'border-v2-line-strong text-v2-ink-2 hover:bg-v2-surface-2',
            state === 'needsTap' && 'border-v2-warn/50 bg-v2-warn-bg text-v2-warn',
            v2Focus,
          )}
        >
          {/* A speaker, not a bell: the bell in the top bar is notifications. */}
          {state === 'on' ? <Volume2 size={18} aria-hidden /> : <VolumeX size={18} aria-hidden />}
          {/* Words only when something is off: a pause counting down, or no sound yet. */}
          {state === 'paused' ? <span className="font-mono text-[13px] tabular-nums">{left}</span> : null}
          {state === 'needsTap' ? <span className="text-[13px]">Tap for sound</span> : null}
        </button>
        {lastEvent ? (
          <span role="status" className="sr-only">
            {lastEvent}
          </span>
        ) : null}
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
      <span
        className={cx('inline-flex h-8 items-center gap-1.5 tabular-nums', stale ? 'text-v2-urgent' : muted)}
        title={`Refreshes itself every ${seconds}s, and the moment an order changes`}
      >
        <span
          aria-hidden
          className={cx(
            'inline-block h-2 w-2 rounded-full',
            stale ? 'bg-v2-urgent' : connected ? 'bg-v2-brand shadow-[0_0_0_3px_var(--color-v2-brand-soft)] motion-safe:animate-pulse' : 'bg-v2-soon',
          )}
        />
        {stale ? 'Not updating, refresh the page' : connected ? 'Up to date' : 'Reconnecting…'}
      </span>
      <button
        type="button"
        onClick={toggleSound}
        aria-pressed={state === 'on'}
        className={cx(
          'inline-flex h-10 items-center gap-1.5 rounded-full border px-4 text-[14px] transition-colors',
          state === 'on'
            ? dark
              ? 'border-v2-mint/40 bg-v2-mint/15 text-v2-mint'
              : 'border-v2-brand bg-v2-brand-soft text-v2-brand'
            : dark
              ? 'border-white/20 text-white/80 hover:bg-white/10'
              : 'border-v2-line-strong text-v2-ink-2 hover:bg-v2-surface-2',
          v2Focus,
        )}
        title={hint}
      >
        {state === 'on' ? <Volume2 size={14} aria-hidden /> : <VolumeX size={14} aria-hidden />}
        <span className="tabular-nums">{words}</span>
      </button>
      {lastEvent ? (
        <span role="status" className={dark ? 'text-v2-mint' : 'text-v2-brand'}>
          {lastEvent}
        </span>
      ) : null}
    </div>
  )
}

/** The loud half of the stale state, in the body where the times it doubts are. */
export function KitchenStaleNotice({ renderedAt, seconds = REFRESH_SECONDS }: { renderedAt: string; seconds?: number }) {
  const stale = useStale(renderedAt, seconds)
  // Shown by the warning icon in the top bar, not as a banner on the page.
  useEffect(() => {
    reportIssue(
      'stale-screen',
      stale
        ? {
            level: 'amber',
            title: 'This screen stopped updating',
            detail: `Last updated at ${stamp(renderedAt)}. Times and statuses may be old. It keeps trying; refreshing the page usually fixes it.`,
          }
        : null,
    )
    return () => reportIssue('stale-screen', null)
  }, [stale, renderedAt])
  return null
}
