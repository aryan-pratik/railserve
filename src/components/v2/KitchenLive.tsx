'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { Volume2, VolumeX } from 'lucide-react'
import { useNowMs } from '@/components/useNow'
import { REFRESH_SECONDS } from '@/lib/liveDay'
import { Notice } from './Table'
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

const SOUND_KEY = 'railserve.v2.kitchenSound'
const soundListeners = new Set<() => void>()

function readSound(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) === '1'
  } catch {
    return false
  }
}
function writeSound(on: boolean) {
  try {
    localStorage.setItem(SOUND_KEY, on ? '1' : '0')
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
const serverSound = () => false

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
}: {
  renderedAt: string
  seconds?: number
  /** On the wall: light text on the dark board. */
  dark?: boolean
}) {
  const router = useRouter()
  const stale = useStale(renderedAt, seconds)
  const soundOn = useSyncExternalStore(subscribeSound, readSound, serverSound)
  const [connected, setConnected] = useState(false)
  const [lastEvent, setLastEvent] = useState<string | null>(null)
  const audioRef = useRef<AudioContext | null>(null)
  // The stream handler reads this; it must not re-subscribe on every toggle.
  const soundRef = useRef(soundOn)
  useEffect(() => {
    soundRef.current = soundOn
  }, [soundOn])

  // Browsers refuse to make noise until the page has been touched. With
  // sound remembered on, the first touch of the page is the unlock.
  useEffect(() => {
    const unlock = () => {
      if (!audioRef.current && soundRef.current) audioRef.current = makeAudio()
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
        if (soundRef.current) chime(audioRef.current)
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

  const toggleSound = useCallback(() => {
    const next = !soundRef.current
    if (next) {
      // Created inside the click, which is the gesture the browser wants.
      if (!audioRef.current) audioRef.current = makeAudio()
      chime(audioRef.current)
    }
    writeSound(next)
  }, [])

  const muted = dark ? 'text-white/70' : 'text-v2-muted'
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
        {stale ? 'Not updating' : connected ? 'Live' : 'Reconnecting…'}
        <span className={cx('font-normal', dark ? 'text-white/50' : 'text-v2-faint')}>· {stamp(renderedAt)}</span>
      </span>
      <button
        type="button"
        onClick={toggleSound}
        aria-pressed={soundOn}
        className={cx(
          'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 transition-colors',
          soundOn
            ? dark
              ? 'border-v2-mint/40 bg-v2-mint/15 text-v2-mint'
              : 'border-v2-brand bg-v2-brand-soft text-v2-brand'
            : dark
              ? 'border-white/20 text-white/80 hover:bg-white/10'
              : 'border-v2-line-strong text-v2-ink-2 hover:bg-v2-surface-2',
          v2Focus,
        )}
        title={soundOn ? 'Chimes on new orders. Click to mute.' : 'Chime when a new order arrives'}
      >
        {soundOn ? <Volume2 size={14} aria-hidden /> : <VolumeX size={14} aria-hidden />}
        {soundOn ? 'Sound on' : 'Sound off'}
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
  if (!stale) return null
  return (
    <Notice tone="warn">
      This screen has not updated since <strong className="tabular-nums">{stamp(renderedAt)}</strong>. Arrival times and order statuses below may be out of date. Check the
      connection; it keeps retrying.
    </Notice>
  )
}
