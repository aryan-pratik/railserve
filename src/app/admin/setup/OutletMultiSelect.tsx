'use client'

import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react'
import { inputClass } from '@/components/ui'
import { IconChevronRight, IconSearch } from '@/components/Icons'

export type OutletOption = { id: string; label: string; station: string; stationName?: string }

type Tab = 'byStation' | 'all'

/** Reflects "some but not all" as a native indeterminate state — plain `checked` can't express it. */
function TriStateCheckbox({
  checked, indeterminate, onChange, ...props
}: {
  checked: boolean
  indeterminate: boolean
  onChange: (checked: boolean) => void
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'checked' | 'onChange' | 'type'>) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])
  return (
    <input
      {...props}
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="size-4 shrink-0 rounded border-line-strong accent-accent"
    />
  )
}

/**
 * An always-visible, embedded panel rather than a popover — a station's
 * outlet list can run long, and a floating popover positioned off a small
 * trigger is exactly the shape that keeps overflowing whatever container it
 * opens inside (a scrolling modal, in particular — see git history on this
 * file). Growing in place, with its own bounded internal scroll, is immune
 * to that class of bug by construction: there's nothing to escape.
 */
export function OutletMultiSelect({
  name, options, defaultSelected, disabled, subtitle,
}: {
  name: string
  options: OutletOption[]
  defaultSelected: string[]
  disabled?: boolean
  subtitle?: string
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set(defaultSelected))
  const [tab, setTab] = useState<Tab>('byStation')

  // Grouped in first-seen order; each group's display name pairs the station's
  // full name with its code when we have one, falling back to the code alone.
  const stations: string[] = []
  const byStation = new Map<string, OutletOption[]>()
  for (const o of options) {
    if (!byStation.has(o.station)) {
      byStation.set(o.station, [])
      stations.push(o.station)
    }
    byStation.get(o.station)!.push(o)
  }
  const stationTitle = (code: string) => {
    const name = byStation.get(code)?.[0]?.stationName
    return name ? `${name} (${code})` : code
  }

  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(stations.filter((s) => byStation.get(s)!.some((o) => selected.has(o.id)))),
  )

  const norm = (s: string) => s.toLowerCase()
  const trimmedQuery = query.trim()
  const matchesOutlet = (o: OutletOption) => !trimmedQuery || norm(o.label).includes(norm(trimmedQuery))
  const matchesStation = (code: string) =>
    !trimmedQuery || norm(stationTitle(code)).includes(norm(trimmedQuery)) || (byStation.get(code) ?? []).some(matchesOutlet)
  const visibleStations = stations.filter(matchesStation)
  const visibleCount = options.filter(matchesOutlet).length

  const toggle = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const toggleStation = (station: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const o of byStation.get(station) ?? []) {
        if (checked) next.add(o.id)
        else next.delete(o.id)
      }
      return next
    })
  }

  const toggleExpanded = (station: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(station)) next.delete(station)
      else next.add(station)
      return next
    })
  }

  // One shape for every role. This used to return a small grey box for an
  // admin and the full panel for everyone else, so the modal was simply the
  // height of whichever one was showing and jumped on every role change. The
  // frame now stays put and only the contents of the fixed-height list area
  // change. A fieldset disables every control inside it in one place.
  const text = subtitle ?? 'Select stations and outlets this staff member can access.'

  return (
    <fieldset
      disabled={disabled}
      className={`min-w-0 overflow-hidden rounded-xl border border-line-strong ${disabled ? 'bg-sunken/40' : 'bg-surface'}`}
    >
      {/* Real, form-submitted checkboxes: kept outside the visual tree since the
          same outlet appears in both tabs; this is the single source of truth.
          Not rendered for an admin, who holds no outlets. The selection itself
          survives in state, so switching the role back restores it. */}
      {disabled
        ? null
        : options.map((o) => (
            <input key={o.id} type="checkbox" name={name} value={o.id} checked={selected.has(o.id)} onChange={() => {}} hidden />
          ))}

      <div className="border-b border-line px-4 py-3">
        <h3 className="text-sm font-semibold text-ink">Assign outlets</h3>
        {/* Two lines reserved whatever the role: the subtitle is a different
            sentence for each one, and letting it wrap to one line or three
            was the other half of the resize. */}
        <p className="mt-0.5 line-clamp-2 min-h-[2lh] text-xs text-muted" title={text}>
          {text}
        </p>
      </div>

      <div className="flex border-b border-line px-4">
        {(
          [
            ['byStation', 'By station'],
            ['all', 'All outlets'],
          ] as const
        ).map(([value, tabLabel]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              tab === value ? 'border-accent text-accent' : 'border-transparent text-muted enabled:hover:text-ink'
            }`}
          >
            {tabLabel}
          </button>
        ))}
      </div>

      <div className="p-3">
        <div className="relative">
          <IconSearch size={16} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search stations or outlets…"
            className={`${inputClass} pl-8`}
          />
        </div>

        {/* Fixed height, not max-height: switching tabs, typing a search query
            or changing the role must never resize this box or the modal around
            it. Only this list scrolls internally, whatever it holds. */}
        <div className="mt-2 h-55 space-y-2 overflow-y-auto">
          {disabled ? (
            <p className="flex h-full items-center justify-center px-6 text-center text-sm text-faint text-balance">
              Admins see every outlet, so they hold none explicitly.
            </p>
          ) : tab === 'byStation' ? (
            visibleStations.map((station) => {
              const group = byStation.get(station) ?? []
              const groupSelected = group.filter((o) => selected.has(o.id)).length
              const allSelected = groupSelected === group.length
              const isExpanded = expanded.has(station)
              return (
                <div key={station} className="overflow-hidden rounded-lg border border-line">
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <TriStateCheckbox
                      checked={allSelected}
                      indeterminate={groupSelected > 0 && !allSelected}
                      onChange={(checked) => toggleStation(station, checked)}
                      aria-label={`Select all outlets at ${stationTitle(station)}`}
                    />
                    <button
                      type="button"
                      onClick={() => toggleExpanded(station)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <IconChevronRight size={14} aria-hidden className={`shrink-0 text-faint transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-ink">{stationTitle(station)}</span>
                        <span className="block text-xs text-muted">{groupSelected} of {group.length} outlets selected</span>
                      </span>
                    </button>
                    <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
                      {groupSelected}/{group.length}
                    </span>
                  </div>
                  {isExpanded ? (
                    <div className="divide-y divide-line border-t border-line">
                      {group.filter(matchesOutlet).map((o) => (
                        <label key={o.id} className="flex cursor-pointer items-center gap-2 py-2 pr-3 pl-9 text-sm text-ink hover:bg-sunken">
                          <input
                            type="checkbox"
                            checked={selected.has(o.id)}
                            onChange={(e) => toggle(o.id, e.target.checked)}
                            className="size-4 shrink-0 rounded border-line-strong accent-accent"
                          />
                          {o.label}
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            })
          ) : (
            options.filter(matchesOutlet).map((o) => (
              <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink hover:bg-sunken">
                <input
                  type="checkbox"
                  checked={selected.has(o.id)}
                  onChange={(e) => toggle(o.id, e.target.checked)}
                  className="size-4 shrink-0 rounded border-line-strong accent-accent"
                />
                {o.label}
              </label>
            ))
          )}
          {!disabled && (tab === 'byStation' ? visibleStations.length === 0 : visibleCount === 0) ? (
            <p className="px-2 py-3 text-center text-sm text-faint">No outlets match &ldquo;{trimmedQuery}&rdquo;.</p>
          ) : null}
        </div>
      </div>
    </fieldset>
  )
}
