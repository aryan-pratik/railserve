'use client'

import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cx, v2Focus } from './ui'

/**
 * On a phone the filter bar's dropdowns fold away behind one "Filters" line,
 * so the search box and the table stay within a thumb's reach. From `md` up
 * the row is always open and the toggle is not drawn. Opens itself when a
 * filter is already set, so what narrows the list is never hidden.
 */
export function OrdersFilterMore({ active, children }: { active: number; children: ReactNode }) {
  const [open, setOpen] = useState(active > 0)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cx('inline-flex w-fit items-center gap-1.5 rounded-full px-1 text-[13px] font-semibold text-v2-ink-2 md:hidden', v2Focus)}
      >
        Filters
        {active > 0 ? <span className="rounded-md bg-v2-brand-soft px-1.5 font-mono text-[11px] tabular-nums text-v2-brand-deep">{active}</span> : null}
        <ChevronDown size={14} className={cx('transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      <div className={cx(open ? 'contents' : 'max-md:hidden md:contents')}>{children}</div>
    </>
  )
}
