'use client'

import { formatRemaining, sessionWindow } from '@/lib/whatsapp/session'
import { useNowMs } from '@/components/useNow'
import { Chip } from '@/components/v2/ui'

/**
 * Whether a free-text reply is allowed right now, and for how much longer.
 * WhatsApp's 24-hour rule is the one thing a telecaller cannot work out by
 * looking at the messages, so it has a permanent place in the header.
 */
export function ChatWindowPill({ lastInboundAt }: { lastInboundAt: string | null }) {
  const now = useNowMs(30_000)
  const w = sessionWindow(lastInboundAt, now ? new Date(now) : new Date())

  if (w.open) {
    return (
      <span title="The passenger wrote within the last 24 hours, so you can reply freely.">
        <Chip tone="ok">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-v2-ok" />
          Open
          {/* Null on the server pass: the count renders once the clock exists. */}
          {now ? <span className="hidden xl:inline">{` · ${formatRemaining(w.closesAt, new Date(now))} left`}</span> : null}
        </Chip>
      </span>
    )
  }
  return (
    <span
      title={
        w.reason === 'never'
          ? 'The passenger has not written yet. Only a template can be sent.'
          : 'More than 24 hours since the passenger last wrote. Only a template can be sent.'
      }
    >
      <Chip tone="grey">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-v2-faint" />
        {w.reason === 'never' ? 'Not yet replied' : 'Window closed'}
      </Chip>
    </span>
  )
}
