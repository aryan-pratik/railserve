'use client'

import { useEffect, useRef, useState } from 'react'
import { cx, v2Focus } from './ui'

/**
 * "Bulk thali × 75 ×75" → { name: "Bulk thali", qty: 75 }. The labels carry
 * the quantity at the end; group orders also repeat it inside the name.
 */
function splitDish(label: string): { name: string; qty: number } {
  const m = label.match(/^(.*?)\s*[×x]\s*(\d+)$/)
  const qty = m ? Number(m[2]) : 1
  const name = (m ? m[1] : label).replace(new RegExp(`\\s*[×x]\\s*${qty}$`), '').trim()
  return { name: name || label, qty }
}

/** One dish per line, its count after it in bold: "Veg Thali  × 20". */
function DishLines({ items, className }: { items: string[]; className?: string }) {
  return (
    <span className={cx('grid gap-0.5', className)}>
      {items.map((label, i) => {
        const { name, qty } = splitDish(label)
        return (
          <span key={`${label}-${i}`} className="block">
            {name}
            {qty > 1 ? <span className="ml-1.5 whitespace-nowrap font-mono font-bold text-v2-ink">× {qty}</span> : null}
          </span>
        )
      })}
    </span>
  )
}

/**
 * What to cook, short: the first few dishes, one per line with their count,
 * then "+3 more". Tapping that opens the whole list (and the kitchen note) in
 * a small popup, without leaving the list or opening the order.
 */
export function DishList({
  items,
  note,
  max = 2,
  className,
}: {
  items: string[]
  note?: string | null
  max?: number
  className?: string
}) {
  // Where the popup sits: measured from the button when it opens, and drawn
  // as a fixed layer so a table's scroll box can never clip it.
  const [at, setAt] = useState<{ top: number; left: number } | null>(null)
  const open = at !== null
  const root = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const close = () => setAt(null)
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  // Only the dishes: the cook needs what to make and how many of each.
  if (items.length === 0) return <span className={cx('block text-v2-faint', className)}>No dishes listed</span>

  const shown = items.slice(0, max)
  const more = items.length - shown.length
  return (
    <span ref={root} className={cx('block whitespace-normal', className)}>
      <DishLines items={shown} />
      {more > 0 ? (
        <>
          <button
            type="button"
            onClick={(e) => {
              // A tap here shows the dishes; it must not also open the order.
              e.preventDefault()
              e.stopPropagation()
              if (open) return setAt(null)
              const r = e.currentTarget.getBoundingClientRect()
              const width = Math.min(320, window.innerWidth * 0.8)
              const below = window.innerHeight - r.bottom > 240
              setAt({
                left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
                top: below ? r.bottom + 6 : Math.max(8, r.top - 6 - 240),
              })
            }}
            aria-expanded={open}
            className={cx('mt-1 whitespace-nowrap rounded-full bg-v2-surface-2 px-2 py-0.5 text-[12.5px] font-semibold text-v2-brand hover:bg-v2-brand-soft', v2Focus)}
          >
            +{more} more
          </button>
        </>
      ) : null}
      {open ? (
        <span
          role="dialog"
          aria-label="All dishes"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          style={at ? { top: at.top, left: at.left } : undefined}
          className="fixed z-[70] block max-h-[240px] w-[min(320px,80vw)] overflow-y-auto rounded-v2-md border border-v2-line bg-v2-surface p-3 text-left whitespace-normal shadow-v2-pop"
        >
          <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-v2-muted">
            {items.length} dish{items.length === 1 ? '' : 'es'}
          </span>
          <DishLines items={items} className="gap-1 text-[14px] font-medium text-v2-ink" />
          {note ? <span className="mt-2 block rounded-sm bg-v2-info-bg px-2 py-1 text-[13px] font-semibold text-v2-info">Note: {note}</span> : null}
        </span>
      ) : null}
    </span>
  )
}
