'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { cx } from './ui'

type Status = 'connecting' | 'live' | 'reconnecting'

/**
 * New payments appear as they land. The server holds `/api/payments/stream`
 * open and says nothing until the collection changes, so a credit shows up
 * within seconds of being written. No pause control on purpose: a stopped
 * feed on a page about money is indistinguishable from a quiet one.
 */
export function PaymentsLive() {
  const router = useRouter()
  const [status, setStatus] = useState<Status>('connecting')

  useEffect(() => {
    const source = new EventSource('/api/payments/stream')
    let lapse: ReturnType<typeof setTimeout> | null = null
    const live = () => {
      if (lapse) clearTimeout(lapse)
      lapse = null
      setStatus('live')
    }
    source.addEventListener('snapshot', live)
    source.addEventListener('ping', live)
    source.addEventListener('change', () => {
      live()
      router.refresh()
    })
    // The stream retires itself every 50s and EventSource reconnects within a
    // few seconds; that planned handover fires onerror too. Only a gap that
    // outlasts the reconnect counts as a dropped connection.
    source.onerror = () => {
      if (lapse) return
      lapse = setTimeout(() => setStatus('reconnecting'), 8_000)
    }
    return () => {
      if (lapse) clearTimeout(lapse)
      source.close()
    }
  }, [router])

  const reconnecting = status === 'reconnecting'
  return (
    <span
      className="inline-flex h-8 items-center gap-2 rounded-full border border-v2-line bg-v2-surface px-3 text-xs font-semibold text-v2-ink-2"
      title={reconnecting ? 'The live connection dropped and is being re-established.' : 'New payments appear here as soon as they are recorded.'}
    >
      <span aria-hidden className={cx('inline-block h-2 w-2 rounded-full', reconnecting ? 'bg-v2-warn' : 'bg-v2-brand motion-safe:animate-pulse')} />
      {reconnecting ? 'Reconnecting' : 'Live'}
    </span>
  )
}
