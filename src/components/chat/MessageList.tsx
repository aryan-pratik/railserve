'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { formatTimeIST } from '@/lib/format'
import { IconAlert, IconCheck, IconCheckDouble } from '@/components/Icons'
import { Spinner } from '@/components/ui'
import type { MessageView } from './chatView'

/**
 * The thread itself, scrolled the way WhatsApp scrolls: newest at the
 * bottom, pinned there as replies arrive, and older history fetched when the
 * reader scrolls up to the top — with the scroll position held still while
 * the older page is inserted above, so the line under their thumb stays put.
 *
 * Outbound lines sit on the right in the console's accent tint, inbound on
 * the left on plain surface. Deliberately not WhatsApp's green: this is
 * RailServe's screen showing a WhatsApp thread, not a copy of WhatsApp, and
 * green already means "called" and "delivered" elsewhere on these pages.
 */
export function MessageList({
  messages: initial,
  hasOlder: initialHasOlder,
  conversationId,
}: {
  messages: MessageView[]
  hasOlder: boolean
  conversationId: string
}) {
  const [older, setOlder] = useState<MessageView[]>([])
  const [hasOlder, setHasOlder] = useState(initialHasOlder)
  const [loading, setLoading] = useState(false)
  const listRef = useRef<HTMLOListElement>(null)
  const topRef = useRef<HTMLLIElement>(null)
  // Height to restore after older rows are prepended.
  const pendingAnchor = useRef<number | null>(null)
  const stickToBottom = useRef(true)

  // A different thread remounts this component (keyed on the id by Thread),
  // so there is no state to reset here.

  // History the reader has already scrolled into may overlap the fresh page
  // the server just sent (a message got a read receipt, say): dedupe by id.
  const all = useMemo(() => {
    const olderIds = new Set(older.map((m) => m.id))
    return [...older, ...initial.filter((m) => !olderIds.has(m.id))]
  }, [older, initial])
  const last = all.at(-1)
  const lastKey = last ? `${last.id}:${last.status}` : 'none'

  // Pin to the bottom on open and whenever a line lands while already there.
  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    if (pendingAnchor.current !== null) {
      el.scrollTop += el.scrollHeight - pendingAnchor.current
      pendingAnchor.current = null
      return
    }
    if (stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [lastKey, all.length, conversationId])

  const loadOlder = useCallback(async () => {
    const el = listRef.current
    const first = all[0]
    if (loading || !hasOlder || !first || !el) return
    setLoading(true)
    try {
      const r = await fetch(`/api/chat/messages?c=${encodeURIComponent(conversationId)}&before=${encodeURIComponent(first.at)}`, { cache: 'no-store' })
      if (!r.ok) throw new Error(String(r.status))
      const data: { messages: MessageView[]; hasOlder?: boolean; hasMore: boolean } = await r.json()
      pendingAnchor.current = el.scrollHeight
      setOlder((prev) => [...data.messages, ...prev])
      setHasOlder(data.hasMore)
    } catch {
      // Leave hasOlder true; scrolling up again retries.
    } finally {
      setLoading(false)
    }
  }, [all, loading, hasOlder, conversationId])

  useEffect(() => {
    const el = topRef.current
    const root = listRef.current
    if (!el || !root || !hasOlder) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadOlder()
      },
      { root, rootMargin: '200px 0px 0px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasOlder, loadOlder])

  function onScroll() {
    const el = listRef.current
    if (!el) return
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }

  if (all.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center bg-canvas p-6 text-center">
        <p className="max-w-xs text-sm text-muted text-pretty">
          Nothing here yet. Whatever you send and whatever the passenger answers shows up in this thread.
        </p>
      </div>
    )
  }

  return (
    <ol
      ref={listRef}
      onScroll={onScroll}
      aria-live="polite"
      className="flex-1 space-y-1 overflow-y-auto bg-canvas px-3 py-3 sm:px-5 [overscroll-behavior:contain] [scrollbar-width:thin]"
    >
      <li ref={topRef} aria-hidden className="flex h-6 items-center justify-center text-[11px] text-faint">
        {loading ? <Spinner size={13} className="text-faint" /> : hasOlder ? null : all.length > 20 ? 'Start of the conversation' : null}
      </li>
      {all.map((m, i) => {
        const day = dayKey(m.at)
        const prev = all[i - 1]
        const newDay = !prev || dayKey(prev.at) !== day
        // Consecutive lines from the same side group tighter, like speech.
        const sameSide = prev && !newDay && prev.direction === m.direction
        return (
          <li key={m.id} className={sameSide ? '' : 'pt-2'}>
            {newDay ? <DayDivider at={m.at} /> : null}
            <Bubble m={m} tail={!sameSide} />
          </li>
        )
      })}
    </ol>
  )
}

/**
 * WhatsApp's own inline markup, as the passenger's phone renders it:
 * *bold*, _italic_, ~struck~. Only whole tokens, so a lone asterisk in a
 * price or a seat stays an asterisk.
 */
function formatWhatsApp(text: string) {
  const parts = text.split(/(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g)
  return parts.map((part, i) => {
    if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) return <strong key={i}>{part.slice(1, -1)}</strong>
    if (part.length > 2 && part.startsWith('_') && part.endsWith('_')) return <em key={i}>{part.slice(1, -1)}</em>
    if (part.length > 2 && part.startsWith('~') && part.endsWith('~')) return <s key={i}>{part.slice(1, -1)}</s>
    return part
  })
}

function dayKey(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium' }).format(new Date(iso))
}

function DayDivider({ at }: { at: string }) {
  const today = dayKey(new Date().toISOString())
  const label = dayKey(at)
  return (
    <div className="my-3 flex justify-center">
      <span className="rounded-full bg-surface px-2.5 py-0.5 text-[11px] font-medium text-muted shadow-2xs ring-1 ring-inset ring-line">
        {label === today ? 'Today' : label}
      </span>
    </div>
  )
}

function Bubble({ m, tail }: { m: MessageView; tail: boolean }) {
  const out = m.direction === 'OUT'
  const failed = m.status === 'FAILED'
  // The first bubble of a run gets a squared corner on its speaker's side,
  // the way WhatsApp marks who is talking.
  const corner = tail ? (out ? 'rounded-tr-md' : 'rounded-tl-md') : ''
  return (
    <div className={`flex ${out ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-1.5 text-sm leading-relaxed shadow-2xs sm:max-w-[70%] ${corner} ${
          out
            ? failed
              ? 'bg-red-50 text-red-900 ring-1 ring-inset ring-red-200'
              : 'bg-accent-soft text-ink'
            : 'bg-surface text-ink ring-1 ring-inset ring-line/70'
        }`}
      >
        {m.kind === 'TEMPLATE' ? (
          <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-accent">
            Template{m.templateName ? ` · ${m.templateName}` : ''}
          </div>
        ) : null}

        {m.kind === 'MEDIA' ? (
          <Media m={m} />
        ) : (
          <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {m.text ? formatWhatsApp(m.text) : <span className="italic text-muted">Unsupported message</span>}
          </p>
        )}

        <div className={`mt-0.5 flex items-center gap-1 text-[11px] ${failed ? 'text-red-700' : 'text-faint'} ${out ? 'justify-end' : ''}`}>
          {out && m.sender ? <span className="truncate">{m.sender}</span> : null}
          <span className="tabular-nums">{formatTimeIST(m.at)}</span>
          {out ? <StatusMark status={m.status} /> : null}
        </div>
        {failed ? <p className="mt-0.5 text-[11px] font-medium text-red-700">{m.failReason ?? 'Not delivered'}</p> : null}
      </div>
    </div>
  )
}

function Media({ m }: { m: MessageView }) {
  const caption = m.mediaCaption ?? m.text
  return (
    <div>
      {m.mediaUrl ? (
        <a href={m.mediaUrl} target="_blank" rel="noreferrer" className="font-medium text-accent underline-offset-2 hover:underline">
          Open attachment
        </a>
      ) : (
        <span className="italic text-muted">Attachment</span>
      )}
      {caption ? <p className="mt-0.5 whitespace-pre-wrap">{caption}</p> : null}
    </div>
  )
}

/** One tick sent, two delivered, two in accent read: WhatsApp's own grammar, which every telecaller already reads. */
function StatusMark({ status }: { status: MessageView['status'] }) {
  switch (status) {
    case 'QUEUED':
      return <Spinner size={11} className="text-faint" />
    case 'SENT':
      return <IconCheck size={13} aria-label="Sent" />
    case 'DELIVERED':
      return <IconCheckDouble size={14} aria-label="Delivered" />
    case 'READ':
      return <IconCheckDouble size={14} aria-label="Read" className="text-accent" />
    case 'FAILED':
      return <IconAlert size={13} aria-label="Failed" />
    default:
      return null
  }
}
