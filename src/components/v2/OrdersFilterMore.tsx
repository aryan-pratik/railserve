'use client'

import { useState, type ReactNode } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { cx, v2Focus } from './ui'

/**
 * The orders list's filters, folded away behind one "Filters" button on every
 * screen size: most visits only need the search box. The button says how many
 * filters are on, and the panel opens by itself when any are, so what narrows
 * the list is never hidden.
 */
export function OrdersFilterMore({ active, toolbar, after, children }: { active: number; toolbar: ReactNode; after?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(active > 0)
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {toolbar}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={active > 0 ? `Filters, ${active} on` : 'Filters'}
          title="Filters"
          className={cx(
            'relative inline-flex h-10 w-10 items-center justify-center rounded-full border transition-colors',
            open || active > 0 ? 'border-v2-brand bg-v2-brand-soft text-v2-brand' : 'border-v2-line-strong text-v2-ink-2 hover:bg-v2-surface-2',
            v2Focus,
          )}
        >
          <SlidersHorizontal size={17} aria-hidden />
          {active > 0 ? <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-v2-brand px-1 font-mono text-[11px] tabular-nums text-white">{active}</span> : null}
        </button>
        {after}
      </div>
      {open ? <div className="grid gap-5 rounded-v2-md border border-v2-line bg-v2-surface-2 p-4">{children}</div> : null}
    </>
  )
}
