'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cx } from './ui'
import { ordersFieldClass } from '@/lib/v2/ordersShared'

/**
 * Any number of stations, picked from a dropdown of tick boxes. Sits in the
 * filter form like a select: the choice rides as one hidden `name` input per
 * station, nothing ticked means every station.
 */
export function OrdersStationSelect({
  name,
  options,
  defaultSelected,
}: {
  name: string
  options: { code: string; name: string | null }[]
  defaultSelected: string[]
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(defaultSelected))
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const picked = options.filter((o) => selected.has(o.code)).map((o) => o.code)
  const label = picked.length === 0 ? 'All stations' : picked.length <= 2 ? picked.join(', ') : `${picked.length} stations`

  return (
    <div ref={rootRef} className="relative min-w-0">
      {picked.map((code) => (
        <input key={code} type="hidden" name={name} value={code} />
      ))}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Stations"
        className={cx(ordersFieldClass, 'flex items-center justify-between gap-2 text-left')}
      >
        <span className={cx('truncate', picked.length === 0 && 'text-v2-muted')}>{label}</span>
        <ChevronDown size={14} className="shrink-0 text-v2-faint" aria-hidden />
      </button>
      {open ? (
        <div
          role="listbox"
          aria-multiselectable
          className="absolute left-0 top-full z-50 mt-1.5 max-h-72 w-full min-w-[14rem] overflow-y-auto rounded-v2-md border border-v2-line bg-v2-surface p-1 shadow-v2-pop"
        >
          {options.length === 0 ? (
            <p className="px-2 py-2 text-sm text-v2-faint">No stations yet.</p>
          ) : (
            options.map((o) => (
              <label key={o.code} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-v2-surface-2">
                <input
                  type="checkbox"
                  checked={selected.has(o.code)}
                  onChange={(e) =>
                    setSelected((prev) => {
                      const next = new Set(prev)
                      if (e.target.checked) next.add(o.code)
                      else next.delete(o.code)
                      return next
                    })
                  }
                  className="size-4 shrink-0 accent-v2-brand"
                />
                <span className="font-mono text-xs font-semibold">{o.code}</span>
                {o.name ? <span className="truncate text-v2-muted">{o.name}</span> : null}
              </label>
            ))
          )}
          {picked.length ? (
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="mt-1 w-full rounded-lg border-t border-v2-line px-2 py-1.5 text-left text-xs font-semibold text-v2-muted hover:bg-v2-surface-2 hover:text-v2-ink"
            >
              Clear selection
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
