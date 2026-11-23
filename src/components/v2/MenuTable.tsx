'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, useTransition } from 'react'
import type { Diet } from '@/lib/diet'
import { menuCategory } from '@/lib/menuCategory'
import type { MenuRow } from '@/lib/repo/menuRepo'
import { formatIST } from '@/lib/format'
import { confirmSuggested, deleteMenuItem, tagMenuItem, type TagResult } from '@/app/admin/menu/actions'
import { forgetMenuPage } from '@/app/v2/menu/actions'
import { Button, Chip, VegMark, cx, v2Focus } from './ui'
import { MenuConfirmDialog } from './MenuConfirmDialog'

/**
 * A tag clicked here. Shown over the row's own data while its save is on the
 * way (`pending`), and afterwards for as long as the rows on the page were
 * read before the save landed (`at >= asOf`, both this server's clock). Once
 * the page holds rows read after it, the row's own data is the truth again.
 */
type Override = { diet: Diet | null; reviewed: boolean; pending: boolean; at: number; seq: number }

/** How long after the last saved click the page re-reads the menu and its counts. */
const REFRESH_AFTER_MS = 2500

/**
 * One page of the menu, every row with its veg / non-veg tag as two toggle
 * buttons. Filtering and paging are the server's (URL state); this holds only
 * what cannot wait for a round trip: the click just made, the rows ticked,
 * and a delete being confirmed.
 */
export function MenuTable({
  rows,
  asOf,
  sourceLabel,
  sourceHref,
  showSource,
}: {
  rows: MenuRow[]
  /** The server's clock just before `rows` was read. */
  asOf: number
  sourceLabel: Record<string, string>
  /** The page narrowed to one aggregator, for the aggregator cell. */
  sourceHref: Record<string, string>
  showSource: boolean
}) {
  const [overrides, setOverrides] = useState<Record<string, Override>>({})
  // Per row, and kept until that row saves: a failure on one row must not be
  // wiped by the next click on another.
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [removed, setRemoved] = useState<Record<string, { pending: boolean; at: number }>>({})
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [deleting, setDeleting] = useState<MenuRow | null>(null)
  const [, startTransition] = useTransition()
  const router = useRouter()
  const seq = useRef(0)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tableRef = useRef<HTMLUListElement>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (refreshTimer.current) {
        // Leaving with a re-read still owed: drop the cached page so Back
        // shows the saved tags, not the ones from before the clicks.
        clearTimeout(refreshTimer.current)
        refreshTimer.current = null
        void forgetMenuPage().catch(() => {})
      }
    }
  }, [])

  /** One re-read after the clicking pauses, not one per click: it recounts every order. */
  function refreshSoon() {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    if (!mounted.current) {
      refreshTimer.current = null
      void forgetMenuPage().catch(() => {})
      return
    }
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null
      router.refresh()
    }, REFRESH_AFTER_MS)
  }

  const merged = rows
    .filter((r) => {
      const gone = removed[r.id]
      return !(gone && (gone.pending || gone.at >= asOf))
    })
    .map((r) => {
      const o = overrides[r.id]
      return o && (o.pending || o.at >= asOf) ? { ...r, diet: o.diet, reviewed: o.reviewed } : r
    })

  /** Shows the change at once, saves it, and settles or rolls back each row when the save answers. */
  function save(changes: { id: string; diet: Diet | null }[], run: () => Promise<TagResult>) {
    const mine = ++seq.current
    const ids = changes.map((c) => c.id)
    setOverrides((s) => {
      const next = { ...s }
      for (const c of changes) next[c.id] = { diet: c.diet, reviewed: true, pending: true, at: 0, seq: mine }
      return next
    })
    startTransition(async () => {
      const res: TagResult = await run().catch(() => ({ error: 'Could not save. Check the connection and try again.' }))
      // A row clicked again since then belongs to that later click.
      setOverrides((s) => {
        const next = { ...s }
        for (const id of ids) {
          if (next[id]?.seq !== mine) continue
          if ('error' in res) delete next[id]
          else next[id] = { ...next[id], pending: false, at: res.at }
        }
        return next
      })
      setErrors((s) => {
        const next = { ...s }
        for (const id of ids) {
          if ('error' in res) next[id] = `Not saved: ${res.error}`
          else delete next[id]
        }
        return next
      })
      if (!('error' in res)) refreshSoon()
    })
  }

  function tag(row: MenuRow, diet: Diet) {
    save([{ id: row.id, diet }], () => tagMenuItem(row.id, diet))
  }

  function confirmRows(list: MenuRow[]) {
    const changes = list.filter((r) => r.diet !== null && !r.reviewed).map((r) => ({ id: r.id, diet: r.diet }))
    if (changes.length === 0) return
    setSelected(new Set())
    save(changes, () => confirmSuggested(changes.map((c) => c.id)))
  }

  /** Hides the row at once, deletes it, and puts it back with a note if the delete fails. */
  function remove(row: MenuRow) {
    setDeleting(null)
    setRemoved((s) => ({ ...s, [row.id]: { pending: true, at: 0 } }))
    setSelected((s) => {
      if (!s.has(row.id)) return s
      const next = new Set(s)
      next.delete(row.id)
      return next
    })
    // The dialog hands focus back to the button that opened it, and that
    // button goes with the row. Keep the keyboard in the table instead.
    requestAnimationFrame(() => tableRef.current?.focus())
    startTransition(async () => {
      const res: TagResult = await deleteMenuItem(row.id).catch(() => ({ error: 'Could not delete. Check the connection and try again.' }))
      setRemoved((s) => {
        const next = { ...s }
        if ('error' in res) delete next[row.id]
        else next[row.id] = { pending: false, at: res.at }
        return next
      })
      setErrors((s) => {
        const next = { ...s }
        if ('error' in res) next[row.id] = `Not deleted: ${res.error}`
        else delete next[row.id]
        return next
      })
      if (!('error' in res)) refreshSoon()
    })
  }

  const suggestedOnPage = merged.filter((r) => r.diet !== null && !r.reviewed)
  const picked = merged.filter((r) => selected.has(r.id))
  const pickedSuggested = picked.filter((r) => r.diet !== null && !r.reviewed).length
  const allPicked = merged.length > 0 && picked.length === merged.length

  function toggleAll() {
    setSelected(allPicked ? new Set() : new Set(merged.map((r) => r.id)))
  }
  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <>
      {/* The selection bar: what is ticked, and the one thing to do with it. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-v2-line px-3.5 py-2.5 text-[12.5px] text-v2-muted">
        {picked.length > 0 ? (
          <>
            <span className="font-semibold text-v2-ink tabular-nums">{picked.length} selected</span>
            <Button size="sm" variant="primary" onClick={() => confirmRows(picked)} disabled={pickedSuggested === 0}>
              Confirm {pickedSuggested} suggested
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </>
        ) : suggestedOnPage.length > 0 ? (
          <>
            <span>
              <span className="font-semibold text-v2-ink tabular-nums">{suggestedOnPage.length}</span> on this page were guessed from the name
            </span>
            <Button size="sm" variant="soft" onClick={() => confirmRows(suggestedOnPage)}>
              They look right: confirm all {suggestedOnPage.length}
            </Button>
          </>
        ) : (
          <span>Tick dishes to confirm several at once.</span>
        )}
      </div>

      <ul ref={tableRef} tabIndex={-1} className="outline-none">
        <li className="flex items-center gap-3 border-b border-v2-line bg-v2-surface-2 px-4 py-2 text-[12px] font-bold uppercase tracking-[0.08em] text-v2-muted">
          <input
            type="checkbox"
            aria-label="Select every dish on this page"
            checked={allPicked}
            onChange={toggleAll}
            className={cx('h-4 w-4 rounded accent-v2-brand', v2Focus)}
          />
          <span className="flex-1">Dish</span>
          <span className="hidden sm:block">Veg or non-veg</span>
          <span className="w-8" aria-hidden />
        </li>
        {merged.map((r) => {
          const isSelected = selected.has(r.id)
          const busy = overrides[r.id]?.pending
          const detail = [menuCategory(r.name), r.orderCount ? `${r.orderCount} order${r.orderCount === 1 ? '' : 's'}` : 'not ordered yet'].join(' · ')
          return (
            <li
              key={r.id}
              className={cx(
                'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-v2-line px-4 py-3 last:border-b-0 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]',
                isSelected && 'bg-v2-brand-soft',
              )}
            >
              <input
                type="checkbox"
                aria-label={`Select ${r.name}`}
                checked={isSelected}
                onChange={() => toggle(r.id)}
                className={cx('h-4 w-4 rounded accent-v2-brand', v2Focus)}
              />
              <div className="min-w-0">
                <div className="flex items-start gap-2">
                  <span className="mt-1.5 shrink-0">
                    <VegMark diet={r.diet} />
                  </span>
                  <span className="text-[15px] font-semibold [overflow-wrap:anywhere]">{r.name}</span>
                  {r.diet === null ? (
                    <Chip tone="grey">Not tagged</Chip>
                  ) : !r.reviewed ? (
                    <span title="Guessed from the dish name. Tap the right one to confirm; until then it prints on the kitchen ticket with a ? after its mark." className="shrink-0 cursor-help">
                      <Chip tone="info">Please check</Chip>
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 pl-[22px] text-[13px] text-v2-muted" title={r.lastOrderedAt ? `Last ordered ${formatIST(r.lastOrderedAt)}` : undefined}>
                  {showSource ? (
                    <Link href={sourceHref[r.source] ?? '#'} className={cx('rounded hover:text-v2-brand hover:underline', v2Focus)}>
                      {sourceLabel[r.source] ?? r.source}
                    </Link>
                  ) : null}
                  {showSource ? ' · ' : ''}
                  {detail}
                </p>
                {errors[r.id] ? (
                  <p role="alert" className="mt-1 pl-[22px] text-[12px] font-semibold text-v2-bad">
                    {errors[r.id]}
                  </p>
                ) : null}
              </div>
              <span
                className={cx('col-start-2 inline-flex w-fit rounded-full border border-v2-line-strong p-0.5 sm:col-start-auto', busy && 'opacity-60')}
                role="group"
                aria-label={`Tag for ${r.name}`}
              >
                <TagButton active={r.diet === 'VEG'} diet="VEG" onClick={() => tag(r, 'VEG')} name={r.name} />
                <TagButton active={r.diet === 'NON_VEG'} diet="NON_VEG" onClick={() => tag(r, 'NON_VEG')} name={r.name} />
              </span>
              <button
                type="button"
                onClick={() => setDeleting(r)}
                aria-label={`Delete ${r.name}`}
                title="Delete this dish"
                className={cx('col-start-3 row-start-1 inline-flex h-8 w-8 items-center justify-center rounded-full text-v2-faint hover:bg-v2-bad-bg hover:text-v2-bad sm:col-start-auto sm:row-start-auto', v2Focus)}
              >
                <Trash2 size={15} aria-hidden />
              </button>
            </li>
          )
        })}
      </ul>

      {deleting ? (
        <MenuConfirmDialog
          titleId="delete-menu-item"
          title="Delete this item?"
          confirmLabel="Delete"
          onConfirm={() => remove(deleting)}
          onCancel={() => setDeleting(null)}
        >
          <span className="font-semibold text-v2-ink">{deleting.name}</span> will be removed from the {sourceLabel[deleting.source] ?? deleting.source} menu.
          {deleting.orderCount === 0
            ? ''
            : deleting.diet !== null && deleting.reviewed
              ? ` It is on ${deleting.orderCount} order${deleting.orderCount === 1 ? '' : 's'}: those keep their veg / non-veg mark.`
              : ` It is on ${deleting.orderCount} order${deleting.orderCount === 1 ? '' : 's'} and its tag is not confirmed, so those print with a ? on the KOT. Tag it first if any of them is still to be cooked.`}{' '}
          If a new order arrives with this item, it comes back on its own.
        </MenuConfirmDialog>
      ) : null}
    </>
  )
}

function TagButton({ active, diet, onClick, name }: { active: boolean; diet: Diet; onClick: () => void; name: string }) {
  const label = diet === 'VEG' ? 'Veg' : 'Non-veg'
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`Tag ${name} as ${label}`}
      onClick={onClick}
      className={cx(
        'inline-flex h-8 items-center rounded-full px-3.5 text-[13px] font-semibold whitespace-nowrap transition-colors',
        active ? (diet === 'VEG' ? 'bg-v2-brand text-white' : 'bg-v2-bad text-white') : 'text-v2-muted hover:bg-v2-surface-2 hover:text-v2-ink',
        v2Focus,
      )}
    >
      {label}
    </button>
  )
}
