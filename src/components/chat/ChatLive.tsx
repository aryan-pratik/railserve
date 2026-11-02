'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type Status = 'connecting' | 'live' | 'reconnecting'

/**
 * Keeps the chat current without a refresh button.
 *
 * Same shape as PaymentsLive: the server says when something in scope moved,
 * and the page re-renders from the server in response. There is no client
 * copy of the thread to keep in sync — the server-rendered thread is the
 * only one — so a reply landing on the phone, a read receipt, or a colleague
 * taking the thread all show up the same way, within a few seconds.
 */
export function ChatLive({ conversationId }: { conversationId?: string }) {
  const router = useRouter()
  const [status, setStatus] = useState<Status>('connecting')

  useEffect(() => {
    const url = conversationId ? `/api/chat/stream?c=${encodeURIComponent(conversationId)}` : '/api/chat/stream'
    const source = new EventSource(url)

    source.addEventListener('snapshot', () => setStatus('live'))
    source.addEventListener('ping', () => setStatus('live'))
    source.addEventListener('change', () => {
      setStatus('live')
      router.refresh()
    })
    source.onerror = () => setStatus('reconnecting')

    return () => source.close()
  }, [router, conversationId])

  return (
    <span
      className="inline-flex h-7 items-center gap-1.5 px-1 text-xs font-medium text-muted"
      title={
        status === 'reconnecting'
          ? 'The live connection dropped and is being re-established.'
          : 'New messages appear here as they arrive.'
      }
    >
      <span
        aria-hidden
        className={`inline-block size-1.5 rounded-full ${
          status === 'reconnecting' ? 'bg-amber-500' : 'bg-emerald-500 motion-safe:animate-pulse'
        }`}
      />
      {status === 'reconnecting' ? 'Reconnecting…' : 'Live'}
    </span>
  )
}
