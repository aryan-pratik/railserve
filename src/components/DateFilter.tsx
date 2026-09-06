'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { DayPicker, type DateRange } from 'react-day-picker'
import 'react-day-picker/style.css'
import type { DateFilterMode } from '@/lib/dateFilter'
import { IconChevronLeft, IconChevronRight } from './Icons'
import { Button, IconButton, segmentClass, segmentedClass } from './ui'
import { useNavTransition } from './navPending'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Local calendar day, not UTC: the day the user actually clicked. */
function toYMD(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function fromYMD(value: string): Date | undefined {
  if (!value) return undefined
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d)
}

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

const CALENDAR_VARS = {
  '--rdp-accent-color': 'var(--color-accent)',
  '--rdp-accent-background-color': 'var(--color-accent-soft)',
  // The library's defaults (44px day cells, 2.75rem nav bar) are sized for a
  // standalone page, not a toolbar popover.
  '--rdp-day-height': '30px',
  '--rdp-day-width': '30px',
  '--rdp-day_button-height': '28px',
  '--rdp-day_button-width': '28px',
  '--rdp-nav-height': '2rem',
  '--rdp-nav_button-height': '1.5rem',
  '--rdp-nav_button-width': '1.5rem',
  '--rdp-weekday-padding': '0.25rem 0rem',
} as CSSProperties

/**
 * Today / This month / a chosen month / a chosen range.
 *
 * The last two open a popover on click. Hover used to open them too, which
 * meant the calendar sprang out whenever the pointer crossed the toolbar on
 * its way to the search box.
 *
 * With `autoSubmit`, picking a value pushes it into the URL straight away,
 * merged with the search params already there. Without it, the choice rides
 * as hidden inputs for the page's own Apply button. The hidden inputs are
 * rendered in both cases, so a form submitted from the search box beside
 * this control carries the date along instead of dropping back to today.
 */
export function DateFilter({
  mode: initialMode,
  month: initialMonth,
  from: initialFrom,
  to: initialTo,
  allowAll = false,
  autoSubmit = false,
}: {
  mode: DateFilterMode
  month: string
  from: string
  to: string
  /** Adds an "All time" option, for lookup views with no default filter. */
  allowAll?: boolean
  /** Pushes the selection into the URL as soon as it is complete. */
  autoSubmit?: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startNav] = useNavTransition()

  const [mode, setMode] = useState<DateFilterMode>(initialMode)
  const [month, setMonth] = useState(initialMonth)
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(initialTo)
  const [openPanel, setOpenPanel] = useState<'month' | 'range' | null>(null)
  const [cursorYear, setCursorYear] = useState(
    () => Number((initialMonth || String(new Date().getFullYear())).slice(0, 4)),
  )

  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!openPanel) return
    function onDocMouseDown(e: MouseEvent) {
      if (rootRef.current?.contains(e.target as Node)) return
      setOpenPanel(null)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenPanel(null)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [openPanel])

  function apply(next: { mode: DateFilterMode; month?: string; from?: string; to?: string }) {
    const nextMonth = next.month ?? ''
    const nextFrom = next.from ?? ''
    const nextTo = next.to ?? ''
    setMode(next.mode)
    setMonth(nextMonth)
    setFrom(nextFrom)
    setTo(nextTo)
    setOpenPanel(null)

    if (!autoSubmit) return

    const params = new URLSearchParams(searchParams.toString())
    params.set('mode', next.mode)
    for (const [k, v] of [['month', nextMonth], ['from', nextFrom], ['to', nextTo]] as const) {
      if (v) params.set(k, v)
      else params.delete(k)
    }
    startNav(() => router.push(`${pathname}?${params.toString()}`, { scroll: false }))
  }

  const plainOptions: { value: DateFilterMode; label: string }[] = [
    ...(allowAll ? [{ value: 'all' as const, label: 'All time' }] : []),
    { value: 'today', label: 'Today' },
    { value: 'month', label: 'This month' },
  ]

  const monthLabel =
    mode === 'custom-month' && month
      ? `${MONTH_LABELS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`
      : 'Pick a month'
  const rangeLabel =
    mode === 'range' && from && to ? `${from.slice(5)} to ${to.slice(5)}` : 'Pick dates'

  const pendingRange: DateRange | undefined =
    mode === 'range' && (from || to) ? { from: fromYMD(from), to: fromYMD(to) } : undefined

  return (
    <div ref={rootRef} className={segmentedClass}>
      {plainOptions.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => apply({ mode: o.value })}
          aria-pressed={mode === o.value}
          className={segmentClass(mode === o.value)}
        >
          {o.label}
        </button>
      ))}

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpenPanel((p) => (p === 'month' ? null : 'month'))}
          aria-expanded={openPanel === 'month'}
          aria-haspopup="dialog"
          className={segmentClass(mode === 'custom-month')}
        >
          {monthLabel}
        </button>
        {openPanel === 'month' ? (
          <div className="absolute left-0 top-full z-50 mt-2 w-64 rounded-xl border border-line bg-surface p-3 shadow-lg">
            <div className="mb-2 flex items-center justify-between">
              <IconButton aria-label="Previous year" size="sm" onClick={() => setCursorYear((y) => y - 1)}>
                <IconChevronLeft size={16} />
              </IconButton>
              <span className="text-sm font-semibold tabular-nums text-ink">{cursorYear}</span>
              <IconButton aria-label="Next year" size="sm" onClick={() => setCursorYear((y) => y + 1)}>
                <IconChevronRight size={16} />
              </IconButton>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {MONTH_LABELS.map((label, i) => {
                const value = `${cursorYear}-${pad(i + 1)}`
                const active = mode === 'custom-month' && month === value
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => apply({ mode: 'custom-month', month: value })}
                    aria-pressed={active}
                    className={`rounded-lg px-2 py-2 text-xs font-medium transition-colors ${
                      active ? 'bg-accent text-white' : 'text-ink hover:bg-sunken'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpenPanel((p) => (p === 'range' ? null : 'range'))}
          aria-expanded={openPanel === 'range'}
          aria-haspopup="dialog"
          className={segmentClass(mode === 'range')}
        >
          {rangeLabel}
        </button>
        {openPanel === 'range' ? (
          <div
            className="absolute left-0 top-full z-50 mt-2 max-w-[calc(100vw-2rem)] overflow-auto rounded-xl border border-line bg-surface p-2 text-xs shadow-lg"
            style={CALENDAR_VARS}
          >
            <DayPicker
              mode="range"
              selected={pendingRange}
              defaultMonth={pendingRange?.from ?? new Date()}
              onSelect={(range) => {
                // Never auto-applies: a range takes two clicks (start, end),
                // and closing after the first would never let the second land.
                setMode('range')
                setFrom(range?.from ? toYMD(range.from) : '')
                setTo(range?.to ? toYMD(range.to) : '')
              }}
            />
            <div className="mt-1 flex items-center justify-between gap-2 border-t border-line pt-2">
              <span className="text-[11px] text-muted">
                {from && to && from !== to ? `${from} to ${to}` : from ? `${from} only` : 'Pick a start date'}
              </span>
              <div className="flex gap-1.5">
                {from ? (
                  <Button type="button" size="sm" variant="ghost" onClick={() => { setFrom(''); setTo('') }}>
                    Clear
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  disabled={!from}
                  onClick={() => apply({ mode: 'range', from, to: to || from })}
                >
                  Apply
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Carried by whichever form this sits in, so a submit from a field
          beside it keeps the date selection. */}
      <input type="hidden" name="mode" value={mode} readOnly />
      {month ? <input type="hidden" name="month" value={month} readOnly /> : null}
      {from ? <input type="hidden" name="from" value={from} readOnly /> : null}
      {to ? <input type="hidden" name="to" value={to} readOnly /> : null}
    </div>
  )
}
