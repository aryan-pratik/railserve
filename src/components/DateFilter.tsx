'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { DayPicker, type DateRange } from 'react-day-picker'
import 'react-day-picker/style.css'
import type { DateFilterMode } from '@/lib/dateFilter'

const PILL =
  'rounded-md px-2.5 py-1.5 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap'

function pillClass(active: boolean) {
  return `${PILL} ${active ? 'bg-surface text-ink font-semibold shadow-2xs' : 'text-muted hover:text-ink'}`
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Local calendar day, not UTC — the day the user actually clicked. */
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
  // standalone page, not a toolbar popover — this keeps the whole thing
  // closer to the width of the pill row that opens it.
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
 * Today / This month / Custom month / Custom range. The last two are pills
 * that open a popover on hover (or click, for touch/keyboard) with a month
 * grid or a react-day-picker range calendar — picking a value applies it
 * immediately.
 *
 * With `autoSubmit`, applying pushes the new mode/month/from/to straight into
 * the URL (merged with whatever search params are already there) — no native
 * form submission involved, so there's nothing to race. Without it (the
 * manual-submit lookup pages), the choice is carried as hidden inputs for the
 * page's own Filter/Show button to pick up.
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
  /** Adds an "All time" pill — for lookup views with no default filter. */
  allowAll?: boolean
  /** Pushes the selection into the URL as soon as it's complete. */
  autoSubmit?: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [mode, setMode] = useState<DateFilterMode>(initialMode)
  const [month, setMonth] = useState(initialMonth)
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(initialTo)
  const [openPanel, setOpenPanel] = useState<'month' | 'range' | null>(null)
  const [cursorYear, setCursorYear] = useState(
    () => Number((initialMonth || String(new Date().getFullYear())).slice(0, 4)),
  )

  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const monthWrapRef = useRef<HTMLDivElement>(null)
  const rangeWrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!openPanel) return
    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as Node
      if (monthWrapRef.current?.contains(target)) return
      if (rangeWrapRef.current?.contains(target)) return
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

  function cancelClose() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }
  function scheduleClose() {
    cancelClose()
    closeTimer.current = setTimeout(() => setOpenPanel(null), 150)
  }

  /** Commits a full mode + value, closes any open popover, and — for
   *  autoSubmit callers — pushes it into the URL right away. */
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
    if (nextMonth) params.set('month', nextMonth)
    else params.delete('month')
    if (nextFrom) params.set('from', nextFrom)
    else params.delete('from')
    if (nextTo) params.set('to', nextTo)
    else params.delete('to')
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }

  const plainOptions: { value: DateFilterMode; label: string }[] = [
    ...(allowAll ? [{ value: 'all' as const, label: 'All time' }] : []),
    { value: 'today', label: 'Today' },
    { value: 'month', label: 'This month' },
  ]

  const monthLabel =
    mode === 'custom-month' && month
      ? `${MONTH_LABELS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`
      : 'Custom month'
  const rangeLabel =
    mode === 'range' && from && to ? `${from.slice(5)} – ${to.slice(5)}` : 'Custom range'

  const pendingRange: DateRange | undefined =
    mode === 'range' && (from || to) ? { from: fromYMD(from), to: fromYMD(to) } : undefined

  return (
    <div className="flex flex-wrap items-center gap-0.5 rounded-lg border border-line bg-sunken/60 p-0.5">
      {plainOptions.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => apply({ mode: o.value })}
          className={pillClass(mode === o.value)}
        >
          {o.label}
        </button>
      ))}

      {/* Custom month */}
      <div
        ref={monthWrapRef}
        className="relative"
        onMouseEnter={() => { cancelClose(); setOpenPanel('month') }}
        onMouseLeave={scheduleClose}
      >
        <button
          type="button"
          onClick={() => setOpenPanel((p) => (p === 'month' ? null : 'month'))}
          className={pillClass(mode === 'custom-month')}
        >
          {monthLabel}
        </button>
        {openPanel === 'month' ? (
          <div className="absolute left-0 top-full z-50 mt-2 w-64 rounded-xl border border-line bg-surface p-3 shadow-lg">
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setCursorYear((y) => y - 1)}
                aria-label="Previous year"
                className="rounded-md px-2 py-1 text-muted hover:bg-sunken hover:text-ink"
              >
                ‹
              </button>
              <span className="text-sm font-semibold tabular-nums text-ink">{cursorYear}</span>
              <button
                type="button"
                onClick={() => setCursorYear((y) => y + 1)}
                aria-label="Next year"
                className="rounded-md px-2 py-1 text-muted hover:bg-sunken hover:text-ink"
              >
                ›
              </button>
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

      {/* Custom range */}
      <div
        ref={rangeWrapRef}
        className="relative"
        onMouseEnter={() => { cancelClose(); setOpenPanel('range') }}
        onMouseLeave={scheduleClose}
      >
        <button
          type="button"
          onClick={() => setOpenPanel((p) => (p === 'range' ? null : 'range'))}
          className={pillClass(mode === 'range')}
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
                // Never auto-applies — a range takes two clicks (start, end),
                // and closing after the first would never let the second land.
                setMode('range')
                setFrom(range?.from ? toYMD(range.from) : '')
                setTo(range?.to ? toYMD(range.to) : '')
              }}
            />
            <div className="mt-1 flex items-center justify-between gap-2 border-t border-line pt-2">
              <span className="text-[11px] text-muted">
                {from && to && from !== to
                  ? `${from} – ${to}`
                  : from
                  ? `${from} only`
                  : 'Pick a start date'}
              </span>
              <div className="flex gap-1.5">
                {from ? (
                  <button
                    type="button"
                    onClick={() => { setFrom(''); setTo('') }}
                    className="rounded-md px-2 py-1 text-[11px] font-medium text-muted hover:bg-sunken hover:text-ink"
                  >
                    Clear
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={!from}
                  onClick={() => apply({ mode: 'range', from, to: to || from })}
                  className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Manual-submit pages read the selection back off these on their own Filter/Show click. */}
      {!autoSubmit ? (
        <>
          <input type="hidden" name="mode" value={mode} readOnly />
          {month ? <input type="hidden" name="month" value={month} readOnly /> : null}
          {from ? <input type="hidden" name="from" value={from} readOnly /> : null}
          {to ? <input type="hidden" name="to" value={to} readOnly /> : null}
        </>
      ) : null}
    </div>
  )
}
