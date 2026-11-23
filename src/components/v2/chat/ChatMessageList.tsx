'use client'

import { useActionState, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Check, CheckCheck, Loader2, RotateCcw } from 'lucide-react'
import { formatTimeIST } from '@/lib/format'
import type { ChatActionState } from '@/app/actions/chat'
import { sendTextV2 } from '@/app/v2/chat/actions'
import { AttachmentModal, previewKind, type Attachment, type PreviewKind } from '@/components/chat/AttachmentModal'
import type { MessageView } from '@/components/chat/chatView'
import { cx, v2Focus } from '@/components/v2/ui'

/**
 * The thread, scrolled the way WhatsApp scrolls: newest at the bottom,
 * pinned there as replies arrive, older history fetched when the reader
 * scrolls to the top with the scroll position held still while it is
 * inserted above. Outbound lines sit on the right in the deep brand green
 * with mint timestamps; inbound on the left in grey.
 */
export function ChatMessageList({ messages: initial, hasOlder: initialHasOlder, conversationId }: { messages: MessageView[]; hasOlder: boolean; conversationId: string }) {
  const [older, setOlder] = useState<MessageView[]>([])
  const [hasOlder, setHasOlder] = useState(initialHasOlder)
  const [loading, setLoading] = useState(false)
  const listRef = useRef<HTMLOListElement>(null)
  const topRef = useRef<HTMLLIElement>(null)
  const pendingAnchor = useRef<number | null>(null)
  const stickToBottom = useRef(true)

  // History already scrolled into may overlap the fresh page (a read receipt, say): dedupe by id.
  const all = useMemo(() => {
    const olderIds = new Set(older.map((m) => m.id))
    return [...older, ...initial.filter((m) => !olderIds.has(m.id))]
  }, [older, initial])
  const last = all.at(-1)

  const attachments = useMemo<Attachment[]>(
    () =>
      all.flatMap((m) =>
        m.kind === 'MEDIA' && m.mediaUrl
          ? [{ id: m.id, url: m.mediaUrl, kind: previewKind(m.mediaType, m.mediaUrl, m.mediaCaption), caption: m.mediaCaption ?? m.text, at: m.at, out: m.direction === 'OUT', sender: m.sender ?? null }]
          : [],
      ),
    [all],
  )
  const [viewing, setViewing] = useState<string | null>(null)
  const viewingIndex = viewing ? attachments.findIndex((a) => a.id === viewing) : -1
  const onViewIndex = useCallback((i: number) => setViewing(attachments[i]?.id ?? null), [attachments])
  const closeViewer = useCallback(() => setViewing(null), [])
  const lastKey = last ? `${last.id}:${last.status}` : 'none'

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
      const data: { messages: MessageView[]; hasMore: boolean } = await r.json()
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
      <div className="flex flex-1 items-center justify-center bg-v2-bg p-6 text-center">
        <p className="max-w-xs text-sm text-v2-muted">Nothing here yet. Whatever you send and whatever the passenger answers shows up in this thread.</p>
      </div>
    )
  }

  return (
    <>
      <ol ref={listRef} onScroll={onScroll} aria-live="polite" className="flex-1 space-y-1 overflow-y-auto bg-v2-bg px-3 py-3 sm:px-5 [overscroll-behavior:contain] [scrollbar-width:thin]">
        <li ref={topRef} aria-hidden className="flex h-6 items-center justify-center text-[11px] text-v2-faint">
          {loading ? <Loader2 size={13} className="animate-spin" /> : hasOlder ? null : all.length > 20 ? 'Start of the conversation' : null}
        </li>
        {all.map((m, i) => {
          const day = dayKey(m.at)
          const prev = all[i - 1]
          const newDay = !prev || dayKey(prev.at) !== day
          const sameSide = prev && !newDay && prev.direction === m.direction
          return (
            <li key={m.id} className={sameSide ? '' : 'pt-2'}>
              {newDay ? <DayDivider at={m.at} /> : null}
              <Bubble m={m} tail={!sameSide} onOpen={setViewing} conversationId={conversationId} />
            </li>
          )
        })}
      </ol>
      {viewingIndex >= 0 ? <AttachmentModal items={attachments} index={viewingIndex} onIndex={onViewIndex} onClose={closeViewer} /> : null}
    </>
  )
}

/** WhatsApp's own inline markup: *bold*, _italic_, ~struck~. Whole tokens only. */
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
      <span className="rounded-full border border-v2-line bg-v2-surface px-2.5 py-0.5 text-[11px] font-semibold text-v2-muted">{label === today ? 'Today' : label}</span>
    </div>
  )
}

function Bubble({ m, tail, onOpen, conversationId }: { m: MessageView; tail: boolean; onOpen: (id: string) => void; conversationId: string }) {
  const out = m.direction === 'OUT'
  const failed = m.status === 'FAILED'
  const corner = tail ? (out ? 'rounded-tr-md' : 'rounded-tl-md') : ''
  return (
    <div className={cx('flex', out ? 'justify-end' : 'justify-start')}>
      <div
        className={cx(
          'max-w-[85%] rounded-2xl px-3 py-1.5 text-sm leading-relaxed sm:max-w-[70%]',
          corner,
          out ? (failed ? 'bg-v2-bad-bg text-v2-ink ring-1 ring-inset ring-v2-bad/30' : 'bg-v2-brand-deep text-white') : 'bg-v2-surface-2 text-v2-ink',
        )}
      >
        {m.kind === 'TEMPLATE' ? (
          <div className={cx('mb-0.5 text-[11px] font-bold uppercase tracking-[0.08em]', out && !failed ? 'text-v2-mint' : 'text-v2-brand')}>
            Template{m.templateName ? ` · ${m.templateName}` : ''}
          </div>
        ) : null}

        {m.kind === 'MEDIA' ? (
          <Media m={m} onOpen={onOpen} out={out && !failed} />
        ) : (
          <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {m.text ? formatWhatsApp(m.text) : <span className="italic opacity-70">Unsupported message</span>}
          </p>
        )}

        <div className={cx('mt-0.5 flex items-center gap-1 text-[11px]', failed ? 'text-v2-bad' : out ? 'text-v2-mint' : 'text-v2-faint', out && 'justify-end')}>
          {out && m.sender ? <span className="truncate">{m.sender}</span> : null}
          <span className="tabular-nums">{formatTimeIST(m.at)}</span>
          {out ? <StatusMark status={m.status} /> : null}
        </div>
        {failed ? (
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-semibold text-v2-bad">{m.failReason ?? 'Not delivered'}</p>
            {m.kind === 'TEXT' && m.text ? <Retry conversationId={conversationId} text={m.text} /> : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** Resends the same text as a new line; the failed one stays as the record. */
function Retry({ conversationId, text }: { conversationId: string; text: string }) {
  const [state, action, pending] = useActionState(sendTextV2, {} as ChatActionState)
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="conversationId" value={conversationId} />
      <input type="hidden" name="text" value={text} />
      <button
        type="submit"
        disabled={pending}
        className={cx('inline-flex h-7 items-center gap-1 rounded-full border border-v2-bad px-2.5 text-[11px] font-semibold text-v2-bad hover:bg-v2-bad/10 disabled:opacity-50', v2Focus)}
      >
        {pending ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <RotateCcw size={12} aria-hidden />}
        Retry
      </button>
      {state.error ? <span className="text-[11px] text-v2-bad">{state.error}</span> : null}
    </form>
  )
}

function Media({ m, onOpen, out }: { m: MessageView; onOpen: (id: string) => void; out: boolean }) {
  const caption = m.mediaCaption ?? m.text
  const [thumbFailed, setThumbFailed] = useState(false)
  if (!m.mediaUrl) {
    // WhatsApp sent the file without a link we can open (see docs/WHATSAPP.md).
    // Say what it is and where to see it, rather than a dead "Attachment".
    return (
      <div className="grid gap-0.5">
        <span className="font-semibold">{MISSING_LABEL[mediaWord(m.mediaType)]}</span>
        <span className="text-[12px] opacity-75">Can&apos;t be shown here. Open WhatsApp on the business phone to see it.</span>
        {caption ? <p className="mt-0.5 whitespace-pre-wrap">{caption}</p> : null}
      </div>
    )
  }
  const kind = previewKind(m.mediaType, m.mediaUrl, m.mediaCaption)
  const thumb = kind === 'image' && !thumbFailed
  if (kind === 'image' && thumbFailed) {
    // The provider's links expire; an old photo can no longer be fetched.
    return (
      <div className="grid gap-0.5">
        <span className="font-semibold">📷 Photo from the passenger</span>
        <span className="text-[12px] opacity-75">The link to this photo no longer works. Open WhatsApp on the business phone to see it.</span>
        {caption ? <p className="mt-0.5 whitespace-pre-wrap">{caption}</p> : null}
      </div>
    )
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => onOpen(m.id)}
        className={thumb ? cx('-mx-1.5 mt-0.5 block overflow-hidden rounded-xl', v2Focus) : cx('rounded font-semibold underline-offset-2 hover:underline', out ? 'text-v2-mint' : 'text-v2-brand', v2Focus)}
      >
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element -- a provider URL on any host
          <img src={m.mediaUrl} alt={caption ?? 'Photo'} loading="lazy" onError={() => setThumbFailed(true)} className="max-h-64 w-auto max-w-full object-cover" />
        ) : (
          ATTACHMENT_LABEL[kind]
        )}
      </button>
      {caption ? <p className="mt-0.5 whitespace-pre-wrap">{caption}</p> : null}
    </div>
  )
}

/** The kind of file, from WhatsApp's word for it. */
function mediaWord(t: string | null | undefined): 'photo' | 'video' | 'voice' | 'document' | 'sticker' | 'file' {
  switch (t) {
    case 'image':
      return 'photo'
    case 'video':
      return 'video'
    case 'audio':
    case 'voice':
      return 'voice'
    case 'document':
      return 'document'
    case 'sticker':
      return 'sticker'
    default:
      return 'file'
  }
}

const MISSING_LABEL: Record<ReturnType<typeof mediaWord>, string> = {
  photo: '📷 Photo from the passenger',
  video: '🎬 Video from the passenger',
  voice: '🎤 Voice note from the passenger',
  document: '📄 Document from the passenger',
  sticker: 'Sticker',
  file: '📎 File from the passenger',
}

const ATTACHMENT_LABEL: Record<PreviewKind, string> = {
  image: 'View photo',
  video: 'Play video',
  audio: 'Play voice note',
  pdf: 'View document',
  file: 'View attachment',
}

/** One tick sent, two delivered, two in white read: WhatsApp's grammar. */
function StatusMark({ status }: { status: MessageView['status'] }) {
  switch (status) {
    case 'QUEUED':
      return <Loader2 size={11} className="animate-spin" aria-label="Sending" />
    case 'SENT':
      return <Check size={13} aria-label="Sent" />
    case 'DELIVERED':
      return <CheckCheck size={14} aria-label="Delivered" />
    case 'READ':
      return <CheckCheck size={14} aria-label="Read" className="text-white" />
    case 'FAILED':
      return <AlertCircle size={13} aria-label="Failed" />
    default:
      return null
  }
}
