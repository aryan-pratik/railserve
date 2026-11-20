'use client'

import { useActionState, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, FormNote, Stat, StatStrip, focusRing, inputBase, segmentClass, segmentedClass, thClass } from '@/components/ui'
import { IconChevronDown, IconSearch } from '@/components/Icons'
import { DietMark } from '@/components/DietMark'
import { formatShortDateTime } from './when'
import type { Diet } from '@/lib/diet'
import type { MenuRow } from '@/lib/repo/menuRepo'
import { addMenuItem, confirmSuggested, tagMenuItem, type MenuState } from './actions'

type Filter = 'all' | 'check' | 'untagged' | 'VEG' | 'NON_VEG'

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
 * The menu, one section per aggregator, with the veg / non-veg tag on every
 * row as two buttons. Filtering and search are done here in the browser: the
 * whole menu is a few hundred short rows and tagging is a click-through job,
 * so a round trip per keystroke would only slow it down.
 */
export function MenuBoard({ rows, sources }: { rows: MenuRow[]; sources: { id: string; label: string }[] }) {
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  // Tags clicked but not yet back from the server, so a row answers at once.
  const [local, setLocal] = useState<Record<string, { diet: Diet | null; reviewed: boolean }>>({})
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const router = useRouter()

  const merged = useMemo(() => rows.map((r) => (local[r.id] ? { ...r, ...local[r.id] } : r)), [rows, local])
  const needle = q.trim().toLowerCase()
  const shown = merged.filter((r) => matches(r, filter) && (!needle || r.name.toLowerCase().includes(needle)))

  const counts = {
    all: merged.length,
    check: merged.filter(needsCheck).length,
    untagged: merged.filter((r) => r.diet === null).length,
    VEG: merged.filter((r) => r.diet === 'VEG').length,
    NON_VEG: merged.filter((r) => r.diet === 'NON_VEG').length,
  }

  function tag(row: MenuRow, diet: Diet) {
    setError(null)
    setLocal((s) => ({ ...s, [row.id]: { diet, reviewed: true } }))
    startTransition(async () => {
      const res = await tagMenuItem(row.id, diet)
      if (res.error) {
        setError(`${row.name}: ${res.error}`)
        setLocal((s) => {
          const { [row.id]: _dropped, ...rest } = s
          return rest
        })
      }
    })
  }

  function confirmAll(list: MenuRow[]) {
    const ids = list.filter((r) => r.diet !== null && !r.reviewed).map((r) => r.id)
    if (ids.length === 0) return
    setError(null)
    setLocal((s) => {
      const next = { ...s }
      for (const r of list) if (ids.includes(r.id)) next[r.id] = { diet: r.diet, reviewed: true }
      return next
    })
    startTransition(async () => {
      const res = await confirmSuggested(ids)
      if (res.error) setError(res.error)
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <StatStrip columns={4}>
        <Stat label="Items" value={String(counts.all)} />
        <Stat label="Veg" value={String(counts.VEG)} />
        <Stat label="Non-veg" value={String(counts.NON_VEG)} />
        <Stat label="Needs check" value={String(counts.check)} tone={counts.check > 0 ? 'text-amber-700' : 'text-ink'} />
      </StatStrip>

      <Card className="flex flex-wrap items-center gap-3 p-3">
        <div className={segmentedClass} role="tablist" aria-label="Filter items">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={segmentClass(filter === f.key)}
            >
              {f.label}
              <span className="tabular-nums text-faint">{counts[f.key]}</span>
            </button>
          ))}
        </div>
        <label className="relative ml-auto block w-full sm:w-64">
          <span className="sr-only">Search items</span>
          <IconSearch size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search items"
            className={`${inputBase} h-9 w-full pl-8 text-sm`}
          />
        </label>
      </Card>

      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-inset ring-red-200">
          {error}
        </p>
      ) : null}

      <AddItemForm sources={sources} />

      {sources.map((s) => {
        const all = merged.filter((r) => r.source === s.id)
        const list = shown.filter((r) => r.source === s.id)
        // While filtering or searching, an aggregator with nothing to show is noise.
        if ((filter !== 'all' || needle) && list.length === 0) return null
        const suggested = list.filter((r) => r.diet !== null && !r.reviewed).length
        const orders = all.reduce((n, r) => n + r.orderCount, 0)
        return (
          <Card key={s.id} className="overflow-hidden">
            <details open={all.length > 0} className="group">
              <summary className={`flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 [&::-webkit-details-marker]:hidden ${focusRing}`}>
                <IconChevronDown size={16} className="shrink-0 text-muted transition-transform group-open:rotate-180" />
                <h2 className="text-sm font-semibold text-ink">{s.label}</h2>
                <span className="text-xs text-muted">
                  {all.length} item{all.length === 1 ? '' : 's'}
                  {all.length > 0 ? (
                    <>
                      {' · '}
                      <span className="inline-flex items-center gap-1">
                        <DietMark diet="VEG" size={11} /> {all.filter((r) => r.diet === 'VEG').length}
                      </span>
                      {' · '}
                      <span className="inline-flex items-center gap-1">
                        <DietMark diet="NON_VEG" size={11} /> {all.filter((r) => r.diet === 'NON_VEG').length}
                      </span>
                      {' · '}
                      {orders} item order{orders === 1 ? '' : 's'}
                    </>
                  ) : null}
                </span>
                {all.some(needsCheck) ? (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900 ring-1 ring-inset ring-amber-200">
                    {all.filter(needsCheck).length} to check
                  </span>
                ) : null}
              </summary>

              {list.length === 0 ? (
                <p className="border-t border-line px-4 py-4 text-sm text-muted">
                  No items yet. They appear here with the first order from this aggregator, or add one above.
                </p>
              ) : (
                <div className="overflow-x-auto border-t border-line">
                  <table className="w-full min-w-[40rem] text-sm">
                    <thead className="border-b border-line bg-sunken/60">
                      <tr>
                        <th className={thClass}>Item</th>
                        <th className={`${thClass} w-20 text-right`}>Orders</th>
                        <th className={`${thClass} w-20 text-right`}>Qty</th>
                        <th className={`${thClass} w-32 whitespace-nowrap`}>Last ordered</th>
                        <th className={`${thClass} w-80 whitespace-nowrap`}>
                          <span className="flex items-center justify-between gap-3">
                            Veg / non-veg
                            {suggested > 0 ? (
                              <button
                                type="button"
                                onClick={() => confirmAll(list)}
                                className={`rounded px-1.5 py-0.5 text-[11px] font-semibold normal-case tracking-normal whitespace-nowrap text-accent hover:bg-accent-soft ${focusRing}`}
                              >
                                Confirm {suggested} suggested
                              </button>
                            ) : null}
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {list.map((r) => (
                        <tr key={r.id} className="hover:bg-sunken/60">
                          <td className="px-3 py-2">
                            <span className="flex items-center gap-2">
                              <DietMark diet={r.diet} />
                              <span className="font-medium text-ink [overflow-wrap:anywhere]">{r.name}</span>
                            </span>
                          </td>
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
                                <span className="text-[11px] text-amber-800" title="Filled in automatically from the item name. Click the right tag to confirm it.">
                                  suggested
                                </span>
                              ) : null}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </details>
          </Card>
        )
      })}

      {shown.length === 0 && (filter !== 'all' || needle) ? (
        <p className="rounded-xl border border-dashed border-line-strong bg-surface p-8 text-center text-sm text-muted">
          Nothing matches.
        </p>
      ) : null}
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
