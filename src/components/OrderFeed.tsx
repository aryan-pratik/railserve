'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Live order feed for the store dashboard (plan §10: SSE plus an audible alert
 * for new orders).
 *
 * The sound is generated with WebAudio rather than shipped as an asset — a
 * kitchen screen needs a noise, not a curated one, and browsers block
 * autoplaying audio until the page has been interacted with anyway, so the
 * control below doubles as that interaction.
 */
export function OrderFeed() {
  const router = useRouter()
  const [connected, setConnected] = useState(false)
  const [soundOn, setSoundOn] = useState(false)
  const [lastEvent, setLastEvent] = useState<string | null>(null)
  const audioRef = useRef<AudioContext | null>(null)

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
        chime(audioRef)
      }
      router.refresh()
    })

    es.onerror = () => setConnected(false)
    return () => es.close()
    // soundOn is read through the ref-gated chime, so it must not re-subscribe.
  }, [router])

  function enableSound() {
    const ctx = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    audioRef.current = ctx
    setSoundOn(true)
    chime(audioRef)
  }

  return (
    <div className="no-print flex items-center gap-3 text-xs">
      <span className="flex items-center gap-1.5 text-slate-500">
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${
            connected ? 'animate-pulse bg-emerald-500' : 'bg-slate-300'
          }`}
        />
        {connected ? 'Live' : 'Reconnecting…'}
      </span>

      {soundOn ? (
        <span className="text-slate-400">🔔 alert on</span>
      ) : (
        <button type="button" onClick={enableSound}
          className="rounded border border-slate-300 px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-50">
          Enable sound
        </button>
      )}

      {lastEvent ? <span className="font-medium text-emerald-700">{lastEvent}</span> : null}
    </div>
  )
}

function chime(ref: React.RefObject<AudioContext | null>) {
  const ctx = ref.current
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
