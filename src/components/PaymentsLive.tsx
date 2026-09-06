'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type Status = 'connecting' | 'live' | 'reconnecting'

/**
 * Pushes new payments onto the screen as they land.
 *
 * Replaces AutoRefresh's 30-second poll. The server holds the connection and
 * says nothing until the collection actually changes, so a payment appears
 * within a few seconds of being written rather than on the next tick of a
 * timer that fires whether or not anything happened.
 *
 * There is deliberately no pause control, for the same reason the board's
 * refresh has none: a stopped feed is indistinguishable from a quiet one and
 * keeps showing a total that was true when it stopped. On a page about money,
 * a stale figure that looks current is the failure worth designing against.
 *
 * The remaining lag is not here — an emailed alert reaches the database on
 * the ingestion cron's schedule, which is the larger half of the wait.
 */
export function PaymentsLive() {
  const router = useRouter()
  const [status, setStatus] = useState<Status>('connecting')

  useEffect(() => {
    const source = new EventSource('/api/payments/stream')

    source.addEventListener('snapshot', () => setStatus('live'))
    source.addEventListener('ping', () => setStatus('live'))
    source.addEventListener('change', () => {
      setStatus('live')
      router.refresh()
    })

    // The stream retires itself just inside the platform's duration cap, so
    // an error here is usually that planned close. EventSource reconnects on
    // its own; this only reflects the gap rather than trying to manage it.
    source.onerror = () => setStatus('reconnecting')

    return () => source.close()
  }, [router])

  const label = status === 'reconnecting' ? 'Reconnecting…' : 'Live'

  return (
    <span
      className="no-print inline-flex items-center gap-2 px-2 py-1 text-xs font-medium text-muted"
      title={
        status === 'reconnecting'
          ? 'The live connection dropped and is being re-established.'
          : 'New payments appear here as soon as they are recorded.'
      }
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          status === 'reconnecting' ? 'bg-amber-500' : 'bg-emerald-500 motion-safe:animate-pulse'
        }`}
      />
      <span>{label}</span>
    </span>
  )
}
