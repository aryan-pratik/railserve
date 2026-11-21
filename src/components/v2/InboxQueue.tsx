'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react'
import { ChevronRight, RotateCw, Trash2, Undo2, X } from 'lucide-react'
import { dismissInbox, reingestInbox, reopenInbox, type BulkInput, type BulkState } from '@/app/v2/inbox/actions'
import { BULK_REINGEST_LIMIT, REASON_LABEL } from '@/lib/inbox'
import { REASON_SHORT, resolutionLabel, type InboxRow } from '@/lib/v2/inboxShared'
import { Sub, Table, TableFrame, Td, Th, rowClass } from './Table'
import { Button, Chip, Mono, cx, v2Focus } from './ui'
import { InboxDrawer, type InboxRowAction } from './InboxDrawer'

type Action = InboxRowAction

const ACTION_FN: Record<Action, (input: BulkInput) => Promise<BulkState>> = {
  dismiss: dismissInbox,
  reingest: reingestInbox,
  reopen: reopenInbox,
}

/**
 * The inbox as a selectable table with a drawer.
 *
 * Rows tick one by one, shift-click as a range, all on the page, or every row
 * matching the filters; the dark bar that appears acts on all of them behind
 * a confirmation that names the count. A dismiss is undoable from the toast,
 * as the batch it was. The open email lives in the URL (`?open=<id>`) so a
 * reload or a shared link lands on the same message; moving between emails
 * rewrites the URL in place rather than through the router, so j/k is instant.
 */
export function InboxQueue({
  rows,
  total,
  resolved,
  query,
  openId,
  pager,
}: {
  rows: InboxRow[]
  /** Rows matching the filters, across every page. */
  total: number
  resolved: boolean
  /** The filters as a query string, for "all matching". */
  query: string
  openId: string | null
  pager: ReactNode
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [allMatching, setAllMatching] = useState(false)
  // The email in the drawer, by id, with its index as a fallback: when an
  // action closes it, the drawer moves on to the row that took its place.
  const [viewing, setViewing] = useState<{ id: string; index: number } | null>(() => {
    const i = openId ? rows.findIndex((r) => r.id === openId) : -1
    return i >= 0 ? { id: openId!, index: i } : null
  })
  const [confirm, setConfirm] = useState<{ action: Action; input: BulkInput; count: number } | null>(null)
  const [toast, setToast] = useState<BulkState | null>(null)
  const [pending, start] = useTransition()
  const anchor = useRef<number | null>(null)

  // A row that closed under us (another admin, our own action) drops out of
  // the selection with it.
  const ids = useMemo(() => rows.map((r) => r.id), [rows])
  const selected = useMemo(() => new Set(ids.filter((id) => picked.has(id))), [ids, picked])
  const allOnPage = selected.size === rows.length && rows.length > 0
  const someOnPage = selected.size > 0 && !allOnPage
  const count = allMatching ? total : selected.size
  const active = count > 0

  const viewIndex = !viewing || rows.length === 0 ? -1 : ids.includes(viewing.id) ? ids.indexOf(viewing.id) : Math.min(viewing.index, rows.length - 1)
  const viewRow = viewIndex >= 0 ? rows[viewIndex] : null

  // Pin the fallback to its id, so rows arriving above it later don't shift
  // the drawer onto a different email. Adjusted during render, React's
  // pattern for state derived from props.
  if (viewing && viewRow && viewRow.id !== viewing.id) setViewing({ id: viewRow.id, index: viewIndex })
  else if (viewing && !viewRow) setViewing(null)

  // Keep `?open=` in step with the drawer without a server round trip.
  useEffect(() => {
    const url = new URL(window.location.href)
    const current = url.searchParams.get('open')
    const next = viewRow?.id ?? null
    if (current === next) return
    if (next) url.searchParams.set('open', next)
    else url.searchParams.delete('open')
    window.history.replaceState(window.history.state, '', url)
  }, [viewRow?.id])

  const show = useCallback(
    (index: number) => {
      if (index >= 0 && index < ids.length) setViewing({ id: ids[index], index })
    },
    [ids],
  )

  const closeView = useCallback(() => {
    const id = viewing?.id
    setViewing(null)
    // Land on the row last viewed, not the one the drawer was opened from.
    if (id) requestAnimationFrame(() => document.getElementById(`inbox-row-${id}`)?.focus())
  }, [viewing])

  const clear = useCallback(() => {
    setPicked(new Set())
    setAllMatching(false)
    anchor.current = null
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (confirm) return
      if (viewRow) {
        if (e.key === 'ArrowLeft' || e.key === 'k') show(viewIndex - 1)
        else if (e.key === 'ArrowRight' || e.key === 'j') show(viewIndex + 1)
        else if (e.key === 'Escape') closeView()
        else return
        e.preventDefault()
      } else if (e.key === 'Escape' && active) {
        clear()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [viewRow, viewIndex, show, closeView, confirm, active, clear])

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
    <>
      <TableFrame>
        <Table>
          <thead>
            <tr>
              <Th className="w-10">
                <Checkbox
                  checked={allOnPage || allMatching}
                  indeterminate={someOnPage && !allMatching}
                  onChange={togglePage}
                  label={allOnPage ? 'Clear selection on this page' : 'Select every email on this page'}
                />
              </Th>
              <Th>Received</Th>
              <Th>Aggregator</Th>
              <Th>Sender</Th>
              <Th className="w-full">Subject</Th>
              <Th>{resolved ? 'Outcome' : 'Reason'}</Th>
              <Th>Parsed</Th>
              {/* `relative` keeps the visually hidden label inside the scrolling
                  frame; absolutely positioned, it would otherwise sit at the
                  table's far right and widen the whole page on a phone. */}
              <Th className="relative">
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <InboxTableRow
                key={row.id}
                row={row}
                selected={allMatching || selected.has(row.id)}
                viewing={viewRow?.id === row.id}
                busy={pending}
                onSelect={(shift) => toggleRow(index, shift)}
                onOpen={() => show(index)}
                onAction={(action) => ask(action, row.id)}
              />
            ))}
          </tbody>
        </Table>
        <div className="border-t border-v2-line">{pager}</div>
      </TableFrame>

      {active ? (
        <div
          role="toolbar"
          aria-label="Selected emails"
          className="fixed bottom-4 left-1/2 z-30 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-full bg-v2-ink px-2 py-2 pl-4 text-sm text-v2-bg shadow-v2-pop"
        >
          <span className="font-semibold tabular-nums">{count} selected</span>
          {allOnPage && !allMatching && total > rows.length ? (
            <button type="button" onClick={() => setAllMatching(true)} className={cx('rounded font-semibold text-v2-mint underline-offset-2 hover:underline', v2Focus)}>
              Select all {total.toLocaleString('en-IN')} matching
            </button>
          ) : null}
          {allMatching ? <span className="text-xs opacity-70">on every page</span> : null}
          <span className="mx-1 hidden h-5 w-px bg-white/20 sm:block" aria-hidden />
          {resolved ? (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => ask('reopen')}>
              <Undo2 size={14} aria-hidden />
              Reopen
            </Button>
          ) : (
            <>
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => ask('reingest')}>
                <RotateCw size={14} aria-hidden />
                Re-ingest
              </Button>
              <Button size="sm" variant="danger" disabled={pending} onClick={() => ask('dismiss')}>
                <Trash2 size={14} aria-hidden />
                Dismiss
              </Button>
            </>
          )}
          <button type="button" aria-label="Clear selection (Esc)" onClick={clear} className={cx('grid h-8 w-8 place-items-center rounded-full hover:bg-white/10', v2Focus)}>
            <X size={16} aria-hidden />
          </button>
        </div>
      ) : null}

      {viewRow ? (
        <InboxDrawer
          row={viewRow}
          index={viewIndex}
          count={rows.length}
          busy={pending}
          onPrev={() => show(viewIndex - 1)}
          onNext={() => show(viewIndex + 1)}
          onClose={closeView}
          onAction={(action) => ask(action, viewRow.id)}
        />
      ) : null}

      {confirm ? (
        <InboxConfirm
          title={confirm.action === 'dismiss' ? `Dismiss ${word(confirm.count)} as not an order?` : confirm.action === 'reingest' ? `Re-ingest ${word(confirm.count)}?` : `Reopen ${word(confirm.count)}?`}
          onCancel={() => setConfirm(null)}
          actions={
            <>
              <Button className="flex-1" variant={confirm.action === 'dismiss' ? 'danger' : 'primary'} disabled={pending} onClick={() => run(confirm.action, confirm.input)}>
                {confirm.action === 'dismiss' ? 'Dismiss' : confirm.action === 'reingest' ? 'Re-ingest' : 'Reopen'} {confirm.count}
              </Button>
              <Button onClick={() => setConfirm(null)}>Cancel</Button>
            </>
          }
        >
          {confirm.action === 'dismiss'
            ? 'They move to Resolved, marked as dismissed by you. Nothing is deleted, and you can reopen them from there.'
            : confirm.action === 'reingest'
              ? `Each email runs through the parsers again as it is. The ones that now parse become orders or payments; the rest stay here untouched.${
                  confirm.count > BULK_REINGEST_LIMIT ? ` This runs the oldest ${BULK_REINGEST_LIMIT}; run it again for the rest.` : ''
                }`
              : 'Dismissed emails go back to Needs attention. Ones that became an order or payment stay resolved.'}
        </InboxConfirm>
      ) : null}

      {toast ? (
        <div
          role="status"
          className={cx(
            'fixed left-1/2 z-[60] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-full px-4 py-2.5 text-sm shadow-v2-pop',
            active ? 'bottom-20' : 'bottom-4',
            toast.error ? 'bg-v2-bad text-white' : 'bg-v2-ink text-v2-bg',
          )}
        >
          <span>{toast.error ?? toast.ok}</span>
          {toast.undo ? (
            <button type="button" onClick={() => undo(toast.undo!)} className={cx('shrink-0 rounded font-bold text-v2-mint underline-offset-2 hover:underline', v2Focus)}>
              Undo
            </button>
          ) : null}
          <button type="button" aria-label="Close" onClick={() => setToast(null)} className={cx('shrink-0 rounded opacity-70 hover:opacity-100', v2Focus)}>
            <X size={14} aria-hidden />
          </button>
        </div>
      ) : null}
    </>
  )
}

function Checkbox({ checked, indeterminate = false, onChange, label }: { checked: boolean; indeterminate?: boolean; onChange: (shift: boolean) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])
  return (
    // The label is the hit area: a 36px square around a 16px box.
    <label className="-m-2 flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg hover:bg-v2-surface-2">
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        aria-label={label}
        onChange={() => undefined}
        onClick={(e) => onChange(e.shiftKey)}
        className={cx('h-4 w-4 cursor-pointer rounded accent-[var(--color-v2-brand)]', v2Focus)}
      />
    </label>
  )
}

function InboxTableRow({
  row,
  selected,
  viewing,
  busy,
  onSelect,
  onOpen,
  onAction,
}: {
  row: InboxRow
  selected: boolean
  viewing: boolean
  busy: boolean
  onSelect: (shift: boolean) => void
  onOpen: () => void
  onAction: (action: Action) => void
}) {
  const title = row.subject || row.detail || '(no subject)'
  const sender = row.senderName || row.senderAddress || row.sourceLabel
  // formatIST gives "27 Aug, 1:25 pm": the day on one line, the time under it.
  const [day, clock] = row.createdAt.split(', ')
  return (
    <tr className={cx(rowClass(selected, true), viewing && !selected && 'bg-v2-surface-2')} onClick={onOpen}>
      <Td onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={selected} onChange={onSelect} label={`Select: ${title}`} />
      </Td>
      <Td>
        <Mono className="text-[12.5px]">
          <time dateTime={row.createdAtIso ?? undefined}>{day}</time>
        </Mono>
        {clock ? <Sub>{clock}</Sub> : null}
      </Td>
      <Td>{row.sourceLabel}</Td>
      <Td className="max-w-[16rem]">
        <span className="block truncate font-semibold" title={row.senderAddress ?? undefined}>
          {sender}
        </span>
        {row.senderName && row.senderAddress ? <Sub className="truncate">{row.senderAddress}</Sub> : null}
      </Td>
      <Td className="max-w-[26rem] whitespace-normal">
        <button
          type="button"
          id={`inbox-row-${row.id}`}
          onClick={(e) => {
            e.stopPropagation()
            onOpen()
          }}
          aria-haspopup="dialog"
          className={cx('block max-w-full rounded text-left', v2Focus)}
        >
          <span className="line-clamp-1 font-medium">{title}</span>
          {row.preview ? <span className="line-clamp-1 text-xs text-v2-faint">{row.preview}</span> : null}
        </button>
      </Td>
      <Td>
        <Chip tone={row.resolved ? (row.resolution === 'DISMISSED' ? 'grey' : 'ok') : 'bad'} className={cx(row.detail && 'cursor-help')}>
          <span title={row.resolved ? undefined : `${REASON_LABEL[row.reason]}${row.detail ? `: ${row.detail}` : ''}`}>
            {row.resolved ? resolutionLabel(row) : REASON_SHORT[row.reason]}
          </span>
        </Chip>
      </Td>
      <Td>
        {row.externalOrderId || row.outletName ? (
          <>
            {row.externalOrderId ? <Mono className="block text-[12.5px]">#{row.externalOrderId}</Mono> : null}
            {row.outletName ? <Sub className="max-w-[12rem] truncate">{row.outletName}</Sub> : null}
          </>
        ) : (
          <span className="text-v2-faint">—</span>
        )}
      </Td>
      <Td onClick={(e) => e.stopPropagation()}>
        <span className="flex items-center justify-end gap-0.5">
          {!row.resolved ? (
            <Button
              variant="ghost"
              size="sm"
              aria-label="Dismiss as not an order"
              disabled={busy}
              onClick={() => onAction('dismiss')}
              className="h-8 w-8 px-0 text-v2-muted opacity-0 hover:text-v2-bad focus-visible:opacity-100 group-hover/row:opacity-100 pointer-coarse:opacity-100"
            >
              <Trash2 size={15} aria-hidden />
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" aria-label="Open email" aria-haspopup="dialog" tabIndex={-1} onClick={onOpen} className="h-8 w-8 px-0 text-v2-muted">
            <ChevronRight size={16} aria-hidden />
          </Button>
        </span>
      </Td>
    </tr>
  )
}

/** A question, a sentence of context, two buttons. Escape cancels. */
function InboxConfirm({ title, children, actions, onCancel }: { title: string; children: ReactNode; actions: ReactNode; onCancel: () => void }) {
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    panel.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      opener?.focus?.()
    }
  }, [onCancel])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-v2-ink/40 p-4" onClick={onCancel}>
      <div
        ref={panel}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="inbox-confirm-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-v2-lg border border-v2-line bg-v2-surface p-5 shadow-v2-pop outline-none"
      >
        <h3 id="inbox-confirm-title" className="text-[17px] font-bold tracking-[-0.01em]">
          {title}
        </h3>
        <p className="mt-2 text-sm text-v2-muted">{children}</p>
        <div className="mt-4 flex gap-2">{actions}</div>
      </div>
    </div>
  )
}
