'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui'
import { IconBell } from '@/components/Icons'

/**
 * Live order feed for the kitchen board: server-sent events plus an audible
 * alert for new orders.
 *
 * The sound is generated with WebAudio rather than shipped as an asset. A
 * kitchen screen needs a noise, not a curated one, and browsers block audio
 * until the page has been interacted with anyway, so the button below doubles
 * as that interaction.
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
  }, [router])

  function enableSound() {
    const ctx = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    audioRef.current = ctx
    setSoundOn(true)
    chime(audioRef)
  }

  return (
    <div className="no-print flex flex-wrap items-center gap-2 text-xs">
      <span className="inline-flex h-7 items-center gap-1.5 px-1 font-medium text-muted" title="New orders appear here as soon as they arrive.">
        <span
          aria-hidden
          className={`inline-block size-1.5 rounded-full ${
            connected ? 'bg-emerald-500 motion-safe:animate-pulse' : 'bg-amber-500'
          }`}
        />
        {connected ? 'Live' : 'Reconnecting…'}
      </span>

      {soundOn ? (
        <span className="inline-flex h-7 items-center gap-1 px-1 text-faint">
          <IconBell size={13} aria-hidden />
          Sound on
        </span>
      ) : (
        <Button type="button" variant="secondary" size="sm" onClick={enableSound}>
          <IconBell size={13} />
          Sound on
        </Button>
      )}

      {lastEvent ? <span role="status" className="font-medium text-emerald-700">{lastEvent}</span> : null}
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
