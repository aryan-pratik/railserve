'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { formatTimeIST } from '@/lib/format'
import type { CancellationAlert } from '@/lib/repo/orderRepo'
import { Card, Chip, Mono, cx, v2Focus } from './ui'

const HEADLINE: Record<string, string> = {
  CANCELLED: 'Cancelled',
  MISDELIVERY: 'Misdelivery',
  MISSED_DELIVERY: 'Missed delivery',
  REFUNDED: 'Refunded',
  RATING_ORDER: 'Rating order',
}

/** Dismissals survive a reload; a card that comes back after "Got it" is noise. */
const ACK_KEY = 'railserve.v2.callsCancellationsAcked'
const ACK_LIMIT = 100
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
    // Dismissal then lasts for this page view only.
  }
}

/**
 * Orders that just left the board the hard way (cancelled, misdelivered,
 * missed, refunded, flagged), newest first, so the desk sees them even
 * though they no longer have a row. Same two paths as the kitchen's alert:
 * the SSE stream, and a poll that takes over when the stream stops
 * delivering. A change in the set also refreshes the board below.
 */
export function CallsCancellationFeed({ endpoint = '/v2/calls/cancellations' }: { endpoint?: string }) {
  const router = useRouter()
  const [items, setItems] = useState<CancellationAlert[]>([])
  const [acked, setAcked] = useState<string[]>([])
  const knownRef = useRef<Set<string> | null>(null)
  const lastMessageRef = useRef(0)
  const ackedRef = useRef<string[] | null>(null)

  const apply = useCallback(
    (next: CancellationAlert[]) => {
      lastMessageRef.current = Date.now()
      if (ackedRef.current === null) {
        const stored = readAcked()
        ackedRef.current = stored
        if (stored.length > 0) setAcked(stored)
      }
      const known = knownRef.current
      const fresh = next.filter((c) => !known || !known.has(c.id))
      knownRef.current = new Set(next.map((c) => c.id))
      setItems((prev) => (prev.length === next.length && prev.every((p, i) => p.id === next[i].id) ? prev : next))
      // The board is still drawing the order as live work; redraw only when the set moved.
      if (known && fresh.length > 0) router.refresh()
    },
    [router],
  )

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch(`${endpoint}?poll=1`, { cache: 'no-store' })
        if (!res.ok) return
        const body = (await res.json()) as { cancellations?: CancellationAlert[] }
        if (!cancelled && Array.isArray(body.cancellations)) apply(body.cancellations)
      } catch {
        // Offline or cut short; the next tick retries.
      }
    }
    const source = new EventSource(endpoint)
    const onData = (e: Event) => {
      try {
        const body = JSON.parse((e as MessageEvent).data) as { cancellations?: CancellationAlert[] }
        if (Array.isArray(body.cancellations)) apply(body.cancellations)
      } catch {
        // Malformed frame; the poll covers a stream that keeps producing them.
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
  }, [apply, endpoint])

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
  // Newest first: the feed arrives oldest-first (v1 showed the oldest three).
  const visible = [...showing].sort((a, b) => Date.parse(b.cancelledAt) - Date.parse(a.cancelledAt))

  return (
    <Card title="Just taken off the board" action={<Chip tone="bad">{visible.length}</Chip>}>
      <ul className="grid gap-2" aria-live="polite">
        {visible.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-v2-md bg-v2-bad-bg/60 px-3 py-2 text-sm">
            <Chip tone="bad">{HEADLINE[c.status] ?? 'Status changed'}</Chip>
            <Link href={`/v2/orders/${c.id}`} className={cx('font-mono font-semibold underline-offset-2 hover:underline', v2Focus)}>
              {c.externalOrderId}
            </Link>
            {c.trainNo ? <Mono className="text-v2-muted">{c.trainNo}</Mono> : null}
            {c.coach || c.rawSeat ? <Mono className="text-v2-muted">{c.coach ? `${c.coach}${c.berth ? ` ${c.berth}` : ''}` : c.rawSeat}</Mono> : null}
            {c.contactName ? <span className="text-v2-ink-2">{c.contactName}</span> : null}
            {c.reason ? (
              <span className="min-w-0 flex-1 truncate text-v2-ink-2" title={c.reason}>
                &ldquo;{c.reason}&rdquo;
              </span>
            ) : (
              <span className="flex-1" />
            )}
            <span className="text-xs text-v2-muted">
              {c.by} · {formatTimeIST(c.cancelledAt)}
            </span>
            <button
              type="button"
              onClick={() => dismiss(c.id)}
              aria-label={`Dismiss ${c.externalOrderId}`}
              title="Got it"
              className={cx('-mr-1 grid h-7 w-7 place-items-center rounded-full text-v2-muted hover:bg-v2-surface hover:text-v2-ink', v2Focus)}
            >
              <X size={14} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}
