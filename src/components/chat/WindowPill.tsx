'use client'

import { formatRemaining, sessionWindow } from '@/lib/whatsapp/session'
import { useNowMs } from '@/components/useNow'

/**
 * Whether a free-text reply is allowed right now, and for how much longer.
 *
 * WhatsApp's 24-hour rule is the one thing about this screen a telecaller
 * cannot work out by looking at the messages, so it gets a permanent place
 * in the header rather than an error after they have typed.
 */
export function WindowPill({ lastInboundAt }: { lastInboundAt: string | null }) {
  const now = useNowMs(30_000)
  const w = sessionWindow(lastInboundAt, now ? new Date(now) : new Date())

  if (w.open) {
    return (
      <span
        title="The passenger wrote within the last 24 hours, so you can reply freely."
        className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200 whitespace-nowrap"
      >
        <span aria-hidden className="size-1.5 rounded-full bg-emerald-500" />
        Open
        {/* Null on the server pass: the count renders once the clock exists.
            Hidden on a narrow two-pane screen, where the header has no room. */}
        {now ? <span className="hidden xl:inline">{` · ${formatRemaining(w.closesAt, new Date(now))} left`}</span> : null}
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
      className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-200 whitespace-nowrap"
    >
      <span aria-hidden className="size-1.5 rounded-full bg-slate-400" />
      {w.reason === 'never' ? 'Not yet replied' : 'Window closed'}
    </span>
  )
}
