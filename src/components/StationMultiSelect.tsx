'use client'

import { useEffect, useRef, useState } from 'react'
import { IconChevronDown } from './Icons'
import { inputClass } from './ui'

export type StationOption = { code: string; name?: string | null }

/**
 * A dropdown of checkboxes for picking any number of stations.
 *
 * Sits in a filter form like a select does: the choice rides as one hidden
 * `name` input per station, so the form's own Apply button carries it, and
 * nothing selected means every station. Opens on click and closes on a click
 * outside or Escape, like the date filter's panels.
 */
export function StationMultiSelect({
  name,
  options,
  defaultSelected,
}: {
  name: string
  options: StationOption[]
  defaultSelected: string[]
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(defaultSelected))
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocMouseDown(e: MouseEvent) {
      if (rootRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const toggle = (code: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(code)
      else next.delete(code)
      return next
    })
  }

  // In option order, not click order, so the label reads the same every time.
  const picked = options.filter((o) => selected.has(o.code)).map((o) => o.code)
  const label =
    picked.length === 0
      ? 'All stations'
      : picked.length <= 2
        ? picked.join(', ')
        : `${picked.length} stations`

  return (
    <div ref={rootRef} className="relative">
      {picked.map((code) => (
        <input key={code} type="hidden" name={name} value={code} />
      ))}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Stations"
        className={`${inputClass} flex items-center justify-between gap-2 text-left`}
      >
        <span className={`truncate ${picked.length ? 'text-ink' : ''}`}>{label}</span>
        <IconChevronDown size={14} aria-hidden className="shrink-0 text-faint" />
      </button>
      {open ? (
        <div
          role="listbox"
          aria-multiselectable
          className="absolute top-full left-0 z-50 mt-1 max-h-72 w-full min-w-[12rem] overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-lg"
        >
          {options.length === 0 ? (
            <p className="px-2 py-2 text-sm text-faint">No stations yet.</p>
          ) : (
            options.map((o) => (
              <label
                key={o.code}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink hover:bg-sunken"
              >
                <input
                  type="checkbox"
                  checked={selected.has(o.code)}
                  onChange={(e) => toggle(o.code, e.target.checked)}
                  className="size-4 shrink-0 rounded border-line-strong accent-accent"
                />
                <span className="font-mono text-xs font-semibold">{o.code}</span>
                {o.name ? <span className="truncate text-muted">{o.name}</span> : null}
              </label>
            ))
          )}
          {picked.length ? (
            <div className="mt-1 border-t border-line px-1 pt-1">
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="w-full rounded-lg px-2 py-1.5 text-left text-xs font-medium text-muted hover:bg-sunken hover:text-ink"
              >
                Clear selection
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
