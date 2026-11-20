'use client'

import { Fragment, useActionState, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, FormNote, Stat, StatStrip, focusRing, inputBase, segmentClass, segmentedClass, thClass } from '@/components/ui'
import { IconSearch } from '@/components/Icons'
import { DietMark } from '@/components/DietMark'
import { formatShortDateTime } from './when'
import type { Diet } from '@/lib/diet'
import { MENU_CATEGORIES, menuCategory } from '@/lib/menuCategory'
import type { MenuRow } from '@/lib/repo/menuRepo'
import { addMenuItem, confirmSuggested, forgetMenuPage, tagMenuItem, type MenuState, type TagResult } from './actions'

type Filter = 'all' | 'check' | 'untagged' | 'VEG' | 'NON_VEG'

const PAGE_SIZES = [25, 50, 100] as const

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'check', label: 'Needs check' },
  { key: 'untagged', label: 'Not tagged' },
  { key: 'VEG', label: 'Veg' },
  { key: 'NON_VEG', label: 'Non-veg' },
]

/** A tag that is only a suggestion still needs a person; so does no tag at all. */
const needsCheck = (r: MenuRow) => r.diet === null || !r.reviewed

function matches(r: MenuRow, filter: Filter) {
  if (filter === 'all') return true
  if (filter === 'check') return needsCheck(r)
  if (filter === 'untagged') return r.diet === null
  return r.diet === filter
}

/**
 * A tag clicked here. Shown over the row's own data while its save is on the
 * way (`pending`), and afterwards for as long as the rows on the page were
 * read before the save landed (`at >= asOf`, both this server's clock). Once
 * the page holds rows read after it, the row's own data is the truth again,
 * so a later change by someone else is never masked by an old click.
 */
type Override = { diet: Diet | null; reviewed: boolean; pending: boolean; at: number; seq: number }

/** How long after the last saved click the page re-reads the menu and its counts. */
const REFRESH_AFTER_MS = 2500

/**
 * The menu as one list, a page at a time, with the veg / non-veg tag on every
 * row as two buttons. Laid out like a restaurant menu, section by section
 * (lib/menuCategory.ts), and narrowed by aggregator, section, tag and search. Filtering and search are done here in the browser: the
 * whole menu is a few hundred short rows and tagging is a click-through job,
 * so a round trip per keystroke would only slow it down.
 */
export function MenuBoard({
  rows,
  asOf,
  sources,
}: {
  rows: MenuRow[]
  /** The server's clock just before `rows` was read. */
  asOf: number
  sources: { id: string; label: string }[]
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const [source, setSource] = useState('all')
  const [category, setCategory] = useState('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(25)
  const [adding, setAdding] = useState(false)
  const [q, setQ] = useState('')
  const [overrides, setOverrides] = useState<Record<string, Override>>({})
  // Per row, and kept until that row saves: a failure on one row must not be
  // wiped by the next click on another.
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [, startTransition] = useTransition()
  const router = useRouter()
  const seq = useRef(0)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (refreshTimer.current) {
        // Leaving with a re-read still owed: the browser keeps this page as
        // it was read, for Back. Drop that copy so Back shows the saved tags.
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
      // The save answered after the page was left: nothing here to refresh.
      refreshTimer.current = null
      void forgetMenuPage().catch(() => {})
      return
    }
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null
      router.refresh()
    }, REFRESH_AFTER_MS)
  }

  const merged = useMemo(
    () =>
      rows.map((r) => {
        const o = overrides[r.id]
        return o && (o.pending || o.at >= asOf) ? { ...r, diet: o.diet, reviewed: o.reviewed } : r
      }),
    [rows, overrides, asOf],
  )
  // The menu section each dish reads under (Thali, Biryani, Breads...), and
  // the list in menu order: section by section, most ordered first in each.
  const grouped = useMemo(() => {
    const rank = new Map(MENU_CATEGORIES.map((c, i) => [c, i]))
    const sectionOf = new Map(rows.map((r) => [r.id, menuCategory(r.name)]))
    const order = [...rows]
      .sort(
        (a, b) =>
          (rank.get(sectionOf.get(a.id)!) ?? 99) - (rank.get(sectionOf.get(b.id)!) ?? 99) ||
          b.orderCount - a.orderCount ||
          a.name.localeCompare(b.name),
      )
      .map((r) => r.id)
    return { sectionOf, position: new Map(order.map((id, i) => [id, i])) }
  }, [rows])
  const sectionOf = (r: MenuRow) => grouped.sectionOf.get(r.id) ?? 'Other'
  const needle = q.trim().toLowerCase()
  const shown = merged
    .filter(
      (r) =>
        (source === 'all' || r.source === source) &&
        (category === 'all' || sectionOf(r) === category) &&
        matches(r, filter) &&
        (!needle || r.name.toLowerCase().includes(needle)),
    )
    .sort((a, b) => (grouped.position.get(a.id) ?? 0) - (grouped.position.get(b.id) ?? 0))

  const counts = {
    all: merged.length,
    check: merged.filter(needsCheck).length,
    untagged: merged.filter((r) => r.diet === null).length,
    VEG: merged.filter((r) => r.diet === 'VEG').length,
    NON_VEG: merged.filter((r) => r.diet === 'NON_VEG').length,
  }

  /** Shows the change at once, saves it, and settles or rolls back each row when the save answers. */
  function save(changes: { id: string; name: string; diet: Diet | null }[], run: () => Promise<TagResult>) {
    const mine = ++seq.current
    const ids = changes.map((c) => c.id)
    setOverrides((s) => {
      const next = { ...s }
      for (const c of changes) next[c.id] = { diet: c.diet, reviewed: true, pending: true, at: 0, seq: mine }
      return next
    })
    startTransition(async () => {
      const res: TagResult = await run().catch(() => ({
        error: 'Could not save. Check the connection and try again.',
      }))
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
          if ('error' in res) next[id] = res.error
          else delete next[id]
        }
        return next
      })
      if (!('error' in res)) refreshSoon()
    })
  }

  function tag(row: MenuRow, diet: Diet) {
    save([{ id: row.id, name: row.name, diet }], () => tagMenuItem(row.id, diet))
  }

  function confirmAll(list: MenuRow[]) {
    const changes = list.filter((r) => r.diet !== null && !r.reviewed).map((r) => ({ id: r.id, name: r.name, diet: r.diet }))
    if (changes.length === 0) return
    save(changes, () => confirmSuggested(changes.map((c) => c.id)))
  }

  // Everything below is one list: narrowed by aggregator, tag and search,
  // then cut into pages. All of it happens in the browser on rows already
  // loaded, so changing a filter or a page is instant.
  const inSource = source === 'all' ? merged : merged.filter((r) => r.source === source)
  const scoped = category === 'all' ? inSource : inSource.filter((r) => sectionOf(r) === category)
  const inScope = (f: Filter) => scoped.filter((r) => matches(r, f)).length
  const pageCount = Math.max(1, Math.ceil(shown.length / pageSize))
  // A filter change can leave the page number past the end; show the last page then.
  const current = Math.min(page, pageCount)
  const visible = shown.slice((current - 1) * pageSize, current * pageSize)
  const suggested = visible.filter((r) => r.diet !== null && !r.reviewed).length
  const labelOf = new Map(sources.map((s) => [s.id, s.label]))
  const filtering = filter !== 'all' || source !== 'all' || category !== 'all' || needle !== ''
  const columns = source === 'all' ? 6 : 5

  return (
    <div className="space-y-4">
      <StatStrip columns={4}>
        <Stat label="Items" value={String(counts.all)} />
        <Stat label="Veg" value={String(counts.VEG)} />
        <Stat label="Non-veg" value={String(counts.NON_VEG)} />
        <Stat label="Needs check" value={String(counts.check)} tone={counts.check > 0 ? 'text-amber-700' : 'text-ink'} />
      </StatStrip>

      <Card className="space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="block">
            <span className="sr-only">Aggregator</span>
            <select
              value={source}
              onChange={(e) => { setSource(e.target.value); setPage(1) }}
              className={`${inputBase} h-9 text-sm`}
            >
              <option value="all">All aggregators ({merged.length})</option>
              {sources.map((s) => {
                const all = merged.filter((r) => r.source === s.id)
                const check = all.filter(needsCheck).length
                return (
                  <option key={s.id} value={s.id}>
                    {s.label} ({all.length}{check > 0 ? `, ${check} to check` : ''})
                  </option>
                )
              })}
            </select>
          </label>
          <label className="block">
            <span className="sr-only">Menu group</span>
            <select
              value={category}
              onChange={(e) => { setCategory(e.target.value); setPage(1) }}
              className={`${inputBase} h-9 text-sm`}
            >
              <option value="all">All groups</option>
              {MENU_CATEGORIES.map((c) => {
                const n = inSource.filter((r) => sectionOf(r) === c).length
                return n > 0 || c === category ? <option key={c} value={c}>{c} ({n})</option> : null
              })}
            </select>
          </label>
          {/* A group of toggle buttons, not tabs: nothing here is a tab panel,
              and a tablist promises arrow-key movement these do not have. */}
          <div className={segmentedClass} role="group" aria-label="Filter items">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter === f.key}
                onClick={() => { setFilter(f.key); setPage(1) }}
                className={segmentClass(filter === f.key)}
              >
                {f.label}
                <span className="tabular-nums text-faint">{inScope(f.key)}</span>
              </button>
            ))}
          </div>
          <label className="relative ml-auto block w-full sm:w-64">
            <span className="sr-only">Search items</span>
            <IconSearch size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1) }}
              placeholder="Search items"
              className={`${inputBase} h-9 w-full pl-8 text-sm`}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-3 text-xs text-muted">
          <span className="tabular-nums">
            {shown.length === 0
              ? 'No items'
              : `${(current - 1) * pageSize + 1} to ${Math.min(current * pageSize, shown.length)} of ${shown.length} item${shown.length === 1 ? '' : 's'}`}
          </span>
          {filtering ? (
            <button
              type="button"
              onClick={() => { setFilter('all'); setSource('all'); setCategory('all'); setQ(''); setPage(1) }}
              className={`rounded font-medium text-accent hover:underline ${focusRing}`}
            >
              Clear filters
            </button>
          ) : null}
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {suggested > 0 ? (
              <Button type="button" size="sm" variant="secondary" onClick={() => confirmAll(visible)}>
                Confirm {suggested} suggested on this page
              </Button>
            ) : null}
            <Button type="button" size="sm" variant="secondary" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
              {adding ? 'Close' : 'Add an item'}
            </Button>
          </span>
        </div>
      </Card>

      {adding ? <AddItemForm sources={sources} /> : null}

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-strong bg-surface p-8 text-center text-sm text-muted">
          {filtering
            ? 'Nothing matches.'
            : 'No items yet. They appear here with the first order from each aggregator, or add one above.'}
        </p>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead className="border-b border-line bg-sunken/60">
                <tr>
                  <th className={thClass}>Item</th>
                  {source === 'all' ? <th className={`${thClass} w-40`}>Aggregator</th> : null}
                  <th className={`${thClass} w-20 text-right`}>Orders</th>
                  <th className={`${thClass} w-20 text-right`}>Qty</th>
                  <th className={`${thClass} w-32 whitespace-nowrap`}>Last ordered</th>
                  <th className={`${thClass} w-64 whitespace-nowrap`}>Veg / non-veg</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visible.map((r, i) => (
                  <Fragment key={r.id}>
                  {/* A heading where the section changes, and at the top of
                      every page so a page never starts without one. */}
                  {i === 0 || sectionOf(visible[i - 1]) !== sectionOf(r) ? (
                    <tr className="bg-sunken/60">
                      <th colSpan={columns} scope="colgroup" className="px-3 py-1.5 text-left text-xs font-semibold text-ink">
                        {sectionOf(r)}
                        <span className="ml-2 font-normal tabular-nums text-muted">
                          {shown.filter((x) => sectionOf(x) === sectionOf(r)).length}
                        </span>
                      </th>
                    </tr>
                  ) : null}
                  <tr className="hover:bg-sunken/60">
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-2">
                        <DietMark diet={r.diet} />
                        <span className="font-medium text-ink [overflow-wrap:anywhere]">{r.name}</span>
                      </span>
                    </td>
                    {source === 'all' ? (
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => { setSource(r.source); setPage(1) }}
                          title={`Show only ${labelOf.get(r.source) ?? r.source}`}
                          className={`rounded text-xs text-muted hover:text-accent hover:underline ${focusRing}`}
                        >
                          {labelOf.get(r.source) ?? r.source}
                        </button>
                      </td>
                    ) : null}
                    <td className="px-3 py-2 text-right tabular-nums text-ink">{r.orderCount || <span className="text-faint">0</span>}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{r.qty || <span className="text-faint">0</span>}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-muted">
                      {r.lastOrderedAt ? formatShortDateTime(r.lastOrderedAt) : <span className="text-faint">never</span>}
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="flex items-center gap-2">
                        <span className={segmentedClass}>
                          <TagButton active={r.diet === 'VEG'} diet="VEG" onClick={() => tag(r, 'VEG')} name={r.name} />
                          <TagButton active={r.diet === 'NON_VEG'} diet="NON_VEG" onClick={() => tag(r, 'NON_VEG')} name={r.name} />
                        </span>
                        {r.diet === null ? (
                          <span className="text-[11px] font-semibold text-amber-800">not tagged</span>
                        ) : !r.reviewed ? (
                          <span className="text-[11px] text-amber-800" title="Filled in automatically from the item name. Click the right tag to confirm it. Until then it prints on the KOT with a ? after its mark.">
                            suggested
                          </span>
                        ) : null}
                      </span>
                      {errors[r.id] ? (
                        <p role="alert" className="mt-1 text-[11px] font-medium text-red-700">
                          Not saved: {errors[r.id]}
                        </p>
                      ) : null}
                    </td>
                  </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-3 py-2 text-xs text-muted">
            <span className="flex items-center gap-2" role="group" aria-label="Items per page">
              Per page
              <span className={segmentedClass}>
                {PAGE_SIZES.map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={pageSize === n}
                    onClick={() => { setPageSize(n); setPage(1) }}
                    className={segmentClass(pageSize === n)}
                  >
                    {n}
                  </button>
                ))}
              </span>
            </span>
            <nav aria-label="Pages" className="flex items-center gap-2">
              <Button type="button" size="sm" variant="secondary" disabled={current <= 1} onClick={() => setPage(current - 1)}>
                Previous
              </Button>
              <span className="tabular-nums">Page {current} of {pageCount}</span>
              <Button type="button" size="sm" variant="secondary" disabled={current >= pageCount} onClick={() => setPage(current + 1)}>
                Next
              </Button>
            </nav>
          </div>
        </Card>
      )}
    </div>
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
      className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium whitespace-nowrap transition-colors ${focusRing} ${
        active
          ? diet === 'VEG'
            ? 'bg-emerald-600 font-semibold text-white'
            : 'bg-red-600 font-semibold text-white'
          : 'text-muted hover:bg-surface hover:text-ink'
      }`}
    >
      {label}
    </button>
  )
}

const initial: MenuState = {}

/** Add a dish before its first order, so that order already prints on the right KOT. */
function AddItemForm({ sources }: { sources: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState(addMenuItem, initial)
  return (
    <Card className="p-3">
      <form action={action} className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">Add an item</span>
          <select name="source" required defaultValue="" className={`${inputBase} h-9 text-sm`}>
            <option value="" disabled>Aggregator</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </label>
        <label className="block min-w-[12rem] flex-1">
          <span className="sr-only">Item name</span>
          <input name="name" required maxLength={200} placeholder="Item name, as the aggregator writes it" className={`${inputBase} h-9 w-full text-sm`} />
        </label>
        <label className="block">
          <span className="sr-only">Veg or non-veg</span>
          <select name="diet" required defaultValue="" className={`${inputBase} h-9 text-sm`}>
            <option value="" disabled>Veg / non-veg</option>
            <option value="VEG">Veg</option>
            <option value="NON_VEG">Non-veg</option>
          </select>
        </label>
        <Button type="submit" variant="primary" pending={pending}>
          Add
        </Button>
        <FormNote state={state} className="w-full" />
      </form>
    </Card>
  )
}
