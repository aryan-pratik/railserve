'use client'

import { useActionState, useEffect, useRef, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { loadInboxBody, resolveUnparsed, type InboxState } from '@/app/v2/inbox/actions'
import { trustSenderFromInbox, type MailActionState } from '@/app/v2/settings/mailActions'
import { REASON_LABEL } from '@/lib/inbox'
import { resolutionLabel, type InboxRow } from '@/lib/v2/inboxShared'
import { KeyValue, Notice } from './Table'
import { Button, ButtonLink, Chip, Eyebrow, Mono, cx, v2Focus } from './ui'
import { inboxTextareaClass } from './InboxPasteCard'

export type InboxRowAction = 'dismiss' | 'reingest' | 'reopen'

/**
 * One email, in a panel on the right of the list. The body is fetched when
 * the panel opens, not with the page: an HTML email can be tens of kilobytes,
 * times a hundred rows. ←/→ or j/k walk the page without closing it.
 */
export function InboxDrawer({
  row,
  index,
  count,
  busy,
  onPrev,
  onNext,
  onClose,
  onAction,
}: {
  row: InboxRow
  index: number
  count: number
  busy: boolean
  onPrev: () => void
  onNext: () => void
  onClose: () => void
  onAction: (action: InboxRowAction) => void
}) {
  const panel = useRef<HTMLDivElement>(null)

  // Focus lands in the panel on open and goes back to the opener on close;
  // the page behind does not scroll while it is up.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    panel.current?.focus()
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
      opener?.focus?.()
    }
  }, [])

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="Close email" className="absolute inset-0 bg-v2-ink/30" onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="inbox-drawer-title"
        className="relative flex h-full w-full max-w-[680px] flex-col border-l border-v2-line bg-v2-surface shadow-v2-pop outline-none"
      >
        <header className="grid gap-2 border-b border-v2-line px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <h2 id="inbox-drawer-title" className="line-clamp-2 text-[17px] font-bold tracking-[-0.01em]">
              {row.subject || row.detail || '(no subject)'}
            </h2>
            <Button variant="ghost" size="sm" aria-label="Close (Esc)" className="h-8 w-8 px-0" onClick={onClose}>
              <X size={16} aria-hidden />
            </Button>
          </div>
          <div className="flex items-center justify-between gap-3 text-xs text-v2-muted">
            <span className="tabular-nums">
              {index + 1} of {count} on this page
              <span className="hidden text-v2-faint sm:inline"> · ← → or j k to move, Esc to close</span>
            </span>
            <span className="flex items-center gap-1">
              <Button variant="ghost" size="sm" aria-label="Previous email" className="h-8 w-8 px-0" disabled={index <= 0} onClick={onPrev}>
                <ChevronLeft size={16} aria-hidden />
              </Button>
              <Button variant="ghost" size="sm" aria-label="Next email" className="h-8 w-8 px-0" disabled={index >= count - 1} onClick={onNext}>
                <ChevronRight size={16} aria-hidden />
              </Button>
            </span>
          </div>
        </header>
        {/* Keyed so the body, the HTML toggle and the correction form start over per email. */}
        <InboxDetail key={row.id} row={row} busy={busy} onAction={onAction} />
      </div>
    </div>
  )
}

const initialState: InboxState = {}

function InboxDetail({ row, busy, onAction }: { row: InboxRow; busy: boolean; onAction: (action: InboxRowAction) => void }) {
  const [raw, setRaw] = useState<{ body: string; text: string } | null | 'loading'>('loading')
  const [showOriginal, setShowOriginal] = useState(false)
  const [correcting, setCorrecting] = useState(false)
  const [state, action, pending] = useActionState(resolveUnparsed, initialState)

  useEffect(() => {
    let live = true
    loadInboxBody(row.id)
      .then((r) => live && setRaw(r))
      .catch(() => live && setRaw(null))
    return () => {
      live = false
    }
  }, [row.id])

  const loaded = raw && raw !== 'loading' ? raw : null
  const isHtml = loaded ? loaded.text !== loaded.body : false
  const shown = loaded ? (showOriginal ? loaded.body : loaded.text) : ''

  const meta: { label: string; value: ReactNode }[] = [
    {
      label: 'Why',
      value: (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <Chip tone={row.resolved ? 'ok' : 'bad'}>{row.resolved ? resolutionLabel(row) : REASON_LABEL[row.reason]}</Chip>
          {row.detail ? <span className="text-v2-ink-2">{row.detail}</span> : null}
        </span>
      ),
    },
    { label: 'From', value: [row.senderName, row.senderAddress && `<${row.senderAddress}>`].filter(Boolean).join(' ') || '—' },
    { label: 'Parser', value: row.sourceLabel },
    { label: 'Received', value: <Mono>{row.createdAt}</Mono> },
  ]
  if (row.resolved) {
    meta.push({
      label: 'Closed',
      value: [row.resolvedAt, row.resolvedBy ? `by ${row.resolvedBy}` : null, row.bulkActionCount && row.bulkActionCount > 1 ? `one of ${row.bulkActionCount} in a bulk action` : null]
        .filter(Boolean)
        .join(' · '),
    })
  }

  return (
    <div className="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto px-5 py-4">
      <KeyValue rows={meta} />

      {row.partial.length ? (
        <div className="grid gap-1.5">
          <Eyebrow>What the parser understood</Eyebrow>
          <div className="flex flex-wrap gap-1.5">
            {row.partial.map((p) => (
              <span key={p.label} className="rounded-md bg-v2-surface-2 px-2 py-0.5 text-xs ring-1 ring-inset ring-v2-line">
                <span className="text-v2-muted">{p.label}</span> <span className="font-medium">{p.value}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {correcting && loaded ? (
        <form action={action} className="grid gap-2">
          <Eyebrow>Corrected email, re-ingested on save</Eyebrow>
          <input type="hidden" name="id" value={row.id} />
          <textarea name="body" rows={14} defaultValue={loaded.body} aria-label="Corrected order email, re-ingested on save" className={inboxTextareaClass} />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="primary" size="sm" disabled={pending}>
              {pending ? 'Re-ingesting…' : 'Re-ingest'}
            </Button>
            <Button size="sm" onClick={() => setCorrecting(false)}>
              Cancel
            </Button>
          </div>
          {state.ok ? <Notice tone="ok">{state.ok}</Notice> : null}
          {state.error ? <Notice tone="bad">{state.error}</Notice> : null}
        </form>
      ) : (
        <div className="grid gap-1.5">
          <div className="flex items-center gap-3">
            <Eyebrow>Email</Eyebrow>
            {isHtml ? (
              <button type="button" onClick={() => setShowOriginal((v) => !v)} className={cx('rounded text-xs font-semibold text-v2-brand hover:underline', v2Focus)}>
                {showOriginal ? 'Show as text' : 'Show original HTML'}
              </button>
            ) : null}
          </div>
          <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-v2-md border border-v2-line bg-v2-surface-2 p-3 font-mono text-xs leading-relaxed text-v2-ink-2">
            {raw === 'loading' ? 'Loading…' : raw === null ? 'This email is no longer in the inbox.' : shown || '(empty body)'}
          </pre>
        </div>
      )}

      {!correcting ? (
        <div className="flex flex-wrap items-center gap-2">
          {row.resolved ? (
            <>
              {row.resolvedOrderId ? (
                <ButtonLink href={`/v2/orders/${row.resolvedOrderId}`} size="sm" variant="primary">
                  View order
                </ButtonLink>
              ) : null}
              {row.resolution === 'PAYMENT' ? (
                <ButtonLink href="/v2/payments" size="sm">
                  View payments
                </ButtonLink>
              ) : null}
              {row.resolution === 'DISMISSED' ? (
                <Button size="sm" disabled={busy} onClick={() => onAction('reopen')}>
                  Reopen
                </Button>
              ) : null}
            </>
          ) : (
            <>
              {/* A held email is trusted or dismissed, never pushed through as is. */}
              {row.reason !== 'SENDER_NOT_TRUSTED' ? (
                <>
                  <Button size="sm" variant="primary" disabled={!loaded} onClick={() => setCorrecting(true)}>
                    Correct and re-ingest
                  </Button>
                  <Button size="sm" disabled={busy} onClick={() => onAction('reingest')}>
                    Re-ingest as is
                  </Button>
                </>
              ) : null}
              <Button size="sm" variant="danger" disabled={busy} onClick={() => onAction('dismiss')}>
                Dismiss
              </Button>
              {row.reason === 'SENDER_NOT_TRUSTED' && row.senderAddress ? <TrustSender row={row} /> : null}
              {row.reason === 'PARSE_FAILED' || row.reason === 'MISSING_FIELD' ? (
                <Link href={`/v2/settings/mail/new?from=${row.id}`} className={cx('ml-auto rounded text-xs font-semibold text-v2-brand hover:underline', v2Focus)}>
                  Teach RailServe this email layout
                </Link>
              ) : null}
              {row.reason === 'UNKNOWN_OUTLET' ? (
                <Link href="/v2/settings?tab=routing" className={cx('ml-auto rounded text-xs font-semibold text-v2-brand hover:underline', v2Focus)}>
                  Add the outlet or an alias in Settings
                </Link>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

/**
 * For an email held back because its sender is not listed: list the sender
 * for the aggregator it looks like, then read the email again. Only for a
 * sender the admin recognises; a stranger's lookalike should be dismissed.
 */
function TrustSender({ row }: { row: InboxRow }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [note, setNote] = useState<MailActionState>({})
  return (
    <span className="grid w-full gap-1.5 rounded-v2-md bg-v2-surface-2 p-3">
      <span className="text-[13px] text-v2-muted">
        If you know <Mono>{row.senderAddress}</Mono> really sends your {row.sourceLabel} orders, trust it: this email and every later one from it will become orders. If you don’t know it, dismiss this email.
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await trustSenderFromInbox(row.id)
              setNote(r)
              router.refresh()
            })
          }
        >
          {pending ? 'Trusting…' : `Trust ${row.senderAddress} for ${row.sourceLabel}`}
        </Button>
        {note.error ? <span role="alert" className="text-[13px] font-semibold text-v2-bad">{note.error}</span> : null}
        {note.ok ? <span role="status" className="text-[13px] font-medium text-v2-ok">{note.ok}</span> : null}
      </span>
    </span>
  )
}
