'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { cx } from '@/components/v2/ui'

type Status = 'connecting' | 'live' | 'reconnecting'

/** How long a dropped stream may stay down before the dot says so. */
const RECONNECT_GRACE_MS = 10_000

/**
 * Keeps the chat current without a refresh button: the server says when
 * something in scope moved and the page re-renders from the server. There is
 * no client copy of the thread to keep in sync.
 */
export function ChatLive({ conversationId }: { conversationId?: string }) {
  const router = useRouter()
  const [status, setStatus] = useState<Status>('connecting')

  useEffect(() => {
    const url = conversationId ? `/api/chat/stream?c=${encodeURIComponent(conversationId)}` : '/api/chat/stream'
    const source = new EventSource(url)
    // The server retires every stream after ~50s and EventSource reconnects
    // on its own, so a single error is routine. Only a gap that outlasts the
    // normal retry is worth turning the dot amber.
    let downTimer: ReturnType<typeof setTimeout> | null = null
    const up = () => {
      if (downTimer) clearTimeout(downTimer)
      downTimer = null
      setStatus('live')
    }
    source.addEventListener('snapshot', up)
    source.addEventListener('ping', up)
    source.addEventListener('change', () => {
      up()
      router.refresh()
    })
    source.onerror = () => {
      if (downTimer) return
      downTimer = setTimeout(() => setStatus('reconnecting'), RECONNECT_GRACE_MS)
    }
    return () => {
      if (downTimer) clearTimeout(downTimer)
      source.close()
    }
  }, [router, conversationId])

  const down = status === 'reconnecting'
  return (
    <span
      className={cx('inline-flex h-8 items-center gap-1.5 text-xs font-semibold', down ? 'text-v2-warn' : 'text-v2-muted')}
      title={down ? 'The live connection dropped and is being re-established.' : 'New messages appear here as they arrive.'}
    >
      <span aria-hidden className={cx('inline-block h-2 w-2 rounded-full', down ? 'bg-v2-soon' : 'bg-v2-brand shadow-[0_0_0_3px_var(--color-v2-brand-soft)]')} />
      {down ? 'Reconnecting…' : 'Live'}
    </span>
  )
}
