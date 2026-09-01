'use client'

import { useRef, useState } from 'react'
import { inputClass } from '@/components/ui'

export type OutletOption = { id: string; label: string }

/**
 * A dropdown, searchable stand-in for a checkbox list, built on
 * `<details>/<summary>` rather than hand-rolled open/close state — the
 * browser owns toggling natively, so there is no click-handler logic of ours
 * that can silently fail to open it.
 *
 * Every option is a real `<input type="checkbox" name={name}>`, always
 * mounted — `<details>` hides its content when closed without unmounting it,
 * so a selection survives closing the panel and posts with the form exactly
 * like the plain checkbox list this replaces.
 */
export function OutletMultiSelect({
  name, options, defaultSelected, disabled,
}: {
  name: string
  options: OutletOption[]
  defaultSelected: string[]
  disabled?: boolean
}) {
  const [query, setQuery] = useState('')
  // Mirrors checkbox .checked so the trigger's summary can react live; the
  // checkboxes themselves remain the source of truth for what gets submitted.
  const [selected, setSelected] = useState<Set<string>>(new Set(defaultSelected))
  const detailsRef = useRef<HTMLDetailsElement>(null)

  const norm = (s: string) => s.toLowerCase()
  const trimmedQuery = query.trim()
  const matches = (o: OutletOption) => !trimmedQuery || norm(o.label).includes(norm(trimmedQuery))
  const visibleCount = options.filter(matches).length

  const summary =
    selected.size === 0
      ? 'Select outlets…'
      : selected.size === 1
        ? (options.find((o) => selected.has(o.id))?.label ?? '1 selected')
        : `${selected.size} outlets selected`

  if (disabled) {
    return (
      <div className={`${inputClass} flex items-center text-faint disabled:cursor-not-allowed`}>
        {summary === 'Select outlets…' ? 'None — admins see every outlet' : summary}
      </div>
    )
  }

  return (
    <details ref={detailsRef} className="group relative">
      <summary
        className={`${inputClass} flex list-none items-center justify-between text-left [&::-webkit-details-marker]:hidden`}
      >
        <span className={selected.size === 0 ? 'text-faint' : 'text-ink'}>{summary}</span>
        <span aria-hidden className="text-faint transition group-open:rotate-180">▾</span>
      </summary>

      <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-line-strong bg-surface shadow-lg">
        <div className="border-b border-line p-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search outlets…"
            className={`${inputClass} py-1.5 text-sm`}
          />
        </div>

        <div className="max-h-56 overflow-y-auto p-1">
          {options.map((o) => (
            <label
              key={o.id}
              hidden={!matches(o)}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink hover:bg-sunken"
            >
              <input
                type="checkbox"
                name={name}
                value={o.id}
                defaultChecked={selected.has(o.id)}
                onChange={(e) => {
                  setSelected((prev) => {
                    const next = new Set(prev)
                    if (e.target.checked) next.add(o.id)
                    else next.delete(o.id)
                    return next
                  })
                }}
                className="size-4 rounded border-line-strong"
              />
              {o.label}
            </label>
          ))}
          {visibleCount === 0 ? (
            <p className="px-2 py-3 text-center text-sm text-faint">No outlets match &ldquo;{trimmedQuery}&rdquo;.</p>
          ) : null}
        </div>
      </div>
    </details>
  )
}
