'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react'
import Link from 'next/link'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { IconChevronRight, IconClose, IconRefresh, IconTrash } from '@/components/Icons'
import { Button, ButtonLink, IconButton, focusRing, focusRingInset } from '@/components/ui'
import { BULK_REINGEST_LIMIT, REASON_LABEL, type InboxReason, type InboxResolution } from '@/lib/inbox'
import { ResolveForm } from './InboxForms'
import { dismissInbox, loadInboxBody, reingestInbox, reopenInbox, type BulkInput, type BulkState } from './actions'
import { REASON_BADGE, REASON_DOT, REASON_SHORT } from './reasonStyle'

export type InboxRowView = {
  id: string
  reason: InboxReason
  source: string
  sourceLabel: string
  subject: string | null
  senderName: string | null
  senderAddress: string | null
  preview: string
  detail: string | null
  externalOrderId: string | null
  gmailMessageId: string | null
  partial: { label: string; value: string }[]
  createdAt: string
  createdAtIso: string | null
  resolved: boolean
  resolvedAt: string | null
  resolvedBy: string | null
  resolution: InboxResolution | null
  resolvedOrderId: string | null
  bulkActionCount: number | null
}

type Action = 'dismiss' | 'reingest' | 'reopen'

const ACTION_FN: Record<Action, (input: BulkInput) => Promise<BulkState>> = {
  dismiss: dismissInbox,
  reingest: reingestInbox,
  reopen: reopenInbox,
}

/**
 * The inbox as a dense, selectable list.
 *
 * Each email is one row — reason, sender, subject and a line of the body —
 * that opens in place to show the raw email and its actions. Rows can be
 * ticked one by one, shift-clicked as a range, all on the page, or every row
 * matching the filters, and the bar that appears acts on all of them at once
 * behind a confirmation that names the count. A dismiss can be undone from
 * the toast that follows it, as the batch it was.
 */
export function InboxList({
  rows,
  total,
  resolved,
  query,
  pager,
}: {
  rows: InboxRowView[]
  /** Rows matching the filters, across every page. */
  total: number
  resolved: boolean
  /** The filters as a query string, for "all matching". */
  query: string
  pager: ReactNode
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [allMatching, setAllMatching] = useState(false)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<{ action: Action; input: BulkInput; count: number } | null>(null)
  const [toast, setToast] = useState<BulkState | null>(null)
  const [pending, start] = useTransition()
  const anchor = useRef<number | null>(null)

  // A row that closed under us (another tab, another admin, our own action)
  // drops out of the selection with it.
  const ids = useMemo(() => rows.map((r) => r.id), [rows])
  const selected = useMemo(() => new Set(ids.filter((id) => picked.has(id))), [ids, picked])
  const allOnPage = selected.size === rows.length && rows.length > 0
  const someOnPage = selected.size > 0 && !allOnPage
  const count = allMatching ? total : selected.size
  const active = count > 0

  const clear = useCallback(() => {
    setPicked(new Set())
    setAllMatching(false)
    anchor.current = null
  }, [])

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirm) clear()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [active, confirm, clear])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), toast.undo ? 12_000 : 8_000)
    return () => clearTimeout(t)
  }, [toast])

  function toggleRow(index: number, shift: boolean) {
    const id = ids[index]
    // Read now: the updater below runs later, after the anchor has moved.
    const from = shift ? anchor.current : null
    setAllMatching(false)
    setPicked((prev) => {
      const next = new Set([...prev].filter((p) => ids.includes(p)))
      const on = !next.has(id)
      if (from !== null) {
        const [a, b] = from < index ? [from, index] : [index, from]
        for (let i = a; i <= b; i++) {
          if (on) next.add(ids[i])
          else next.delete(ids[i])
        }
      } else if (on) next.add(id)
      else next.delete(id)
      return next
    })
    anchor.current = index
  }

  function togglePage() {
    setAllMatching(false)
    setPicked(allOnPage ? new Set() : new Set(ids))
  }

  function toggleOpen(id: string) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function ask(action: Action, only?: string) {
    const input: BulkInput = only ? { ids: [only] } : allMatching ? { query } : { ids: [...selected] }
    // One row's own button needs no question: a dismiss is undoable from the
    // toast, and a re-ingest only ever closes a row that now parses.
    if (only) return run(action, input)
    setConfirm({ action, input, count })
  }

  function run(action: Action, input: BulkInput) {
    setConfirm(null)
    start(async () => {
      const result = await ACTION_FN[action](input)
      setToast(result)
      if (!('ids' in input && input.ids.length === 1)) clear()
    })
  }

  function undo(bulkActionId: string) {
    setToast(null)
    start(async () => setToast(await reopenInbox({ bulkActionId })))
  }

  const word = (n: number) => `${n} email${n === 1 ? '' : 's'}`

  return (
    <div className="overflow-clip rounded-xl border border-line bg-surface shadow-sm">
      {/* The header doubles as the bulk bar: the same strip, so nothing jumps. */}
      <div
        className={`sticky top-0 z-20 flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2 transition-colors ${
          active ? 'border-accent/30 bg-accent-soft' : 'border-line bg-surface'
        }`}
      >
        <Checkbox
          checked={allOnPage || allMatching}
          indeterminate={someOnPage && !allMatching}
          onChange={togglePage}
          label={allOnPage ? 'Clear selection on this page' : 'Select every email on this page'}
        />

        {active ? (
          <>
            <span className="text-sm font-semibold text-ink tabular-nums">{count} selected</span>
            {allOnPage && !allMatching && total > rows.length ? (
              <button
                type="button"
                onClick={() => setAllMatching(true)}
                className={`rounded text-sm font-medium text-accent underline-offset-2 hover:underline ${focusRing}`}
              >
                Select all {total} matching
              </button>
            ) : null}
            {allMatching ? (
              <span className="text-xs text-muted">Every email matching the filters, on every page.</span>
            ) : null}

            <div className="ml-auto flex flex-wrap items-center gap-2">
              {resolved ? (
                <Button size="sm" variant="secondary" pending={pending} onClick={() => ask('reopen')}>
                  Reopen dismissed
                </Button>
              ) : (
                <>
                  <Button size="sm" variant="secondary" pending={pending} onClick={() => ask('reingest')}>
                    <IconRefresh size={14} aria-hidden />
                    Re-ingest
                  </Button>
                  <Button size="sm" variant="danger" pending={pending} onClick={() => ask('dismiss')}>
                    <IconTrash size={14} aria-hidden />
                    Dismiss as not an order
                  </Button>
                </>
              )}
              <IconButton size="sm" aria-label="Clear selection (Esc)" onClick={clear}>
                <IconClose size={16} />
              </IconButton>
            </div>
          </>
        ) : (
          <span className="text-xs text-muted">
            <span className="sm:hidden">Tick emails to act on many at once.</span>
            <span className="hidden sm:inline">Tick emails to act on many at once. Shift-click selects a range; Esc clears.</span>
          </span>
        )}
      </div>

      <ul role="list" className="divide-y divide-line">
        {rows.map((row, index) => (
          <InboxRow
            key={row.id}
            row={row}
            selected={allMatching || selected.has(row.id)}
            open={open.has(row.id)}
            busy={pending}
            onSelect={(shift) => toggleRow(index, shift)}
            onToggle={() => toggleOpen(row.id)}
            onAction={(action) => ask(action, row.id)}
          />
        ))}
      </ul>

      <div className="border-t border-line">{pager}</div>

      {confirm ? (
        <ConfirmDialog
          titleId="inbox-bulk-confirm"
          title={
            confirm.action === 'dismiss'
              ? `Dismiss ${word(confirm.count)} as not an order?`
              : confirm.action === 'reingest'
                ? `Re-ingest ${word(confirm.count)}?`
                : `Reopen ${word(confirm.count)}?`
          }
          onCancel={() => setConfirm(null)}
          actions={
            <>
              <Button
                className="flex-1"
                variant={confirm.action === 'dismiss' ? 'danger' : 'primary'}
                pending={pending}
                onClick={() => run(confirm.action, confirm.input)}
              >
                {confirm.action === 'dismiss' ? 'Dismiss' : confirm.action === 'reingest' ? 'Re-ingest' : 'Reopen'}{' '}
                {confirm.count}
              </Button>
              <Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button>
            </>
          }
        >
          {confirm.action === 'dismiss' ? (
            <>
              They move to Resolved, marked as dismissed by you. Nothing is deleted, and you can reopen them from
              there.
            </>
          ) : confirm.action === 'reingest' ? (
            <>
              Each email runs through the parsers again as it is. The ones that now parse become orders or payments;
              the rest stay here untouched.
              {confirm.count > BULK_REINGEST_LIMIT
                ? ` This runs the oldest ${BULK_REINGEST_LIMIT}; run it again for the rest.`
                : ''}
            </>
          ) : (
            <>Dismissed emails go back to Needs attention. Ones that became an order or payment stay resolved.</>
          )}
        </ConfirmDialog>
      ) : null}

      {toast ? (
        <div
          role="status"
          className={`fixed bottom-4 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-xl px-4 py-2.5 text-sm shadow-lg ${
            toast.error ? 'bg-red-700 text-white' : 'bg-ink text-surface'
          }`}
        >
          <span className="text-pretty">{toast.error ?? toast.ok}</span>
          {toast.undo ? (
            <button
              type="button"
              onClick={() => undo(toast.undo!)}
              className={`shrink-0 rounded font-semibold text-accent-soft underline-offset-2 hover:underline ${focusRing}`}
            >
              Undo
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Close"
            onClick={() => setToast(null)}
            className={`shrink-0 rounded opacity-70 hover:opacity-100 ${focusRing}`}
          >
            <IconClose size={14} />
          </button>
        </div>
      ) : null}
    </div>
  )
}

function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  label,
}: {
  checked: boolean
  indeterminate?: boolean
  onChange: (shift: boolean) => void
  label: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])
  return (
    // The label is the hit area: a 36px square around a 16px box.
    <label className="-m-2 flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg hover:bg-sunken">
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        aria-label={label}
        onChange={() => undefined}
        onClick={(e) => onChange(e.shiftKey)}
        className={`size-4 cursor-pointer rounded accent-[var(--color-accent)] ${focusRing}`}
      />
    </label>
  )
}

function InboxRow({
  row,
  selected,
  open,
  busy,
  onSelect,
  onToggle,
  onAction,
}: {
  row: InboxRowView
  selected: boolean
  open: boolean
  busy: boolean
  onSelect: (shift: boolean) => void
  onToggle: () => void
  onAction: (action: Action) => void
}) {
  const sender = row.senderName || row.senderAddress || row.sourceLabel
  const title = row.subject || row.detail || '(no subject)'
  const panelId = `inbox-row-${row.id}`

  return (
    <li className={`group/row ${selected ? 'bg-accent-soft/50' : open ? 'bg-sunken/40' : ''}`}>
      <div className="flex items-start gap-3 px-3 py-2 sm:items-center">
        <div className="pt-0.5 sm:pt-0">
          <Checkbox checked={selected} onChange={onSelect} label={`Select: ${title}`} />
        </div>

        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          className={`grid min-w-0 flex-1 grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 rounded-md py-1 text-left sm:grid-cols-[8.5rem_minmax(0,13rem)_1fr_7.5rem] ${focusRingInset}`}
        >
          <span
            className={`col-start-1 row-start-2 inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset sm:row-start-1 ${
              row.resolved ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : REASON_BADGE[row.reason]
            }`}
            title={REASON_LABEL[row.reason]}
          >
            <span aria-hidden className={`size-1.5 rounded-full ${row.resolved ? 'bg-emerald-500' : REASON_DOT[row.reason]}`} />
            {row.resolved ? resolutionShort(row) : REASON_SHORT[row.reason]}
          </span>

          <span className="col-start-1 row-start-1 min-w-0 truncate text-sm font-medium text-ink sm:col-start-2">
            {sender}
          </span>

          <span className="col-span-2 row-start-3 min-w-0 truncate text-sm sm:col-span-1 sm:col-start-3 sm:row-start-1">
            <span className="text-ink">{title}</span>
            {row.externalOrderId && !title.includes(row.externalOrderId) ? (
              <span className="ml-1.5 font-mono text-xs text-muted tabular-nums">#{row.externalOrderId}</span>
            ) : null}
            {row.preview ? <span className="text-faint"> — {row.preview}</span> : null}
          </span>

          <time
            dateTime={row.createdAtIso ?? undefined}
            className="col-start-2 row-start-1 text-right text-xs whitespace-nowrap text-muted tabular-nums sm:col-start-4"
          >
            {row.createdAt}
          </time>
        </button>

        <div className="flex shrink-0 items-center gap-0.5">
          {!row.resolved ? (
            <IconButton
              size="sm"
              aria-label="Dismiss as not an order"
              disabled={busy}
              onClick={() => onAction('dismiss')}
              className="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
            >
              <IconTrash size={15} />
            </IconButton>
          ) : null}
          <IconButton size="sm" aria-label={open ? 'Collapse' : 'Expand'} onClick={onToggle}>
            <IconChevronRight size={16} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
          </IconButton>
        </div>
      </div>

      {open ? <InboxDetail id={panelId} row={row} busy={busy} onAction={onAction} /> : null}
    </li>
  )
}

function resolutionShort(row: InboxRowView): string {
  if (row.resolution === 'ORDER') return 'Order created'
  if (row.resolution === 'PAYMENT') return 'Payment'
  if (row.resolution === 'DISMISSED') return 'Dismissed'
  return 'Resolved'
}

function InboxDetail({
  id,
  row,
  busy,
  onAction,
}: {
  id: string
  row: InboxRowView
  busy: boolean
  onAction: (action: Action) => void
}) {
  const [raw, setRaw] = useState<{ body: string; text: string } | null | 'loading'>('loading')
  const [showOriginal, setShowOriginal] = useState(false)
  const [correcting, setCorrecting] = useState(false)

  // The body is fetched on open, not shipped with the page: an HTML email can
  // be tens of kilobytes, times a hundred rows a page.
  useEffect(() => {
    let live = true
    loadInboxBody(row.id)
      .then((r) => live && setRaw(r))
      .catch(() => live && setRaw(null))
    return () => {
      live = false
    }
  }, [row.id])

  const isHtml = raw && raw !== 'loading' && raw.text !== raw.body
  const shown = raw && raw !== 'loading' ? (showOriginal ? raw.body : raw.text) : ''

  const meta: { label: string; value: ReactNode }[] = [
    { label: 'Why', value: <span className="text-ink">{REASON_LABEL[row.reason]}{row.detail ? `: ${row.detail}` : ''}</span> },
    { label: 'From', value: [row.senderName, row.senderAddress && `<${row.senderAddress}>`].filter(Boolean).join(' ') || '—' },
    { label: 'Subject', value: row.subject ?? '—' },
    { label: 'Parser', value: row.sourceLabel },
    { label: 'Received', value: row.createdAt },
  ]
  if (row.resolved) {
    meta.push({
      label: 'Closed',
      value: (
        <>
          {resolutionShort(row)} {row.resolvedAt ? `· ${row.resolvedAt}` : ''}
          {row.resolvedBy ? ` · by ${row.resolvedBy}` : ''}
          {row.bulkActionCount && row.bulkActionCount > 1 ? ` · one of ${row.bulkActionCount} in a bulk action` : ''}
        </>
      ),
    })
  }

  return (
    <div id={id} className="space-y-3 border-t border-line/70 bg-sunken/30 px-4 py-3 sm:pl-14">
      <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1 text-sm">
        {meta.map((m) => (
          <div key={m.label} className="contents">
            <dt className="text-xs font-medium tracking-wide text-faint uppercase sm:pt-0.5">{m.label}</dt>
            <dd className="min-w-0 break-words text-muted">{m.value}</dd>
          </div>
        ))}
      </dl>

      {row.partial.length ? (
        <div>
          <p className="mb-1 text-xs font-medium tracking-wide text-faint uppercase">What the parser understood</p>
          <div className="flex flex-wrap gap-1.5">
            {row.partial.map((p) => (
              <span key={p.label} className="rounded-md bg-surface px-2 py-0.5 text-xs ring-1 ring-line ring-inset">
                <span className="text-faint">{p.label}</span> <span className="text-ink">{p.value}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {correcting && raw && raw !== 'loading' ? (
        <div className="space-y-2">
          <ResolveForm id={row.id} body={raw.body} initiallyOpen onClose={() => setCorrecting(false)} />
        </div>
      ) : (
        <div>
          <div className="mb-1 flex items-center gap-3">
            <p className="text-xs font-medium tracking-wide text-faint uppercase">Email</p>
            {isHtml ? (
              <button
                type="button"
                onClick={() => setShowOriginal((v) => !v)}
                className={`rounded text-xs font-medium text-accent hover:underline ${focusRing}`}
              >
                {showOriginal ? 'Show as text' : 'Show original HTML'}
              </button>
            ) : null}
          </div>
          <pre className="max-h-80 overflow-auto rounded-lg border border-line bg-surface p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted">
            {raw === 'loading' ? 'Loading…' : raw === null ? 'This email is no longer in the inbox.' : shown || '(empty body)'}
          </pre>
        </div>
      )}

      {!correcting ? (
        <div className="flex flex-wrap items-center gap-2">
          {row.resolved ? (
            <>
              {row.resolvedOrderId ? (
                <ButtonLink href={`/admin/orders/${row.resolvedOrderId}`} size="sm">View order</ButtonLink>
              ) : null}
              {row.resolution === 'PAYMENT' ? (
                <ButtonLink href="/admin/payments" size="sm">Payments</ButtonLink>
              ) : null}
              {row.resolution === 'DISMISSED' ? (
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => onAction('reopen')}>
                  Reopen
                </Button>
              ) : null}
            </>
          ) : (
            <>
              <Button size="sm" disabled={!raw || raw === 'loading'} onClick={() => setCorrecting(true)}>
                Correct and re-ingest
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => onAction('reingest')}>
                Re-ingest as is
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => onAction('dismiss')}>
                Dismiss as not an order
              </Button>
              {row.reason === 'UNKNOWN_OUTLET' ? (
                <Link href="/admin/setup" className={`ml-auto rounded text-xs font-medium text-accent hover:underline ${focusRing}`}>
                  Add the outlet or an alias in Setup
                </Link>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
