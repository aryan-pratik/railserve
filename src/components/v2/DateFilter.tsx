'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { DayPicker as Calendar, type DateRange } from 'react-day-picker'
import 'react-day-picker/style.css'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import type { DateFilterMode } from '@/lib/dateFilter'
import { useNavTransition } from '@/components/navPending'
import { Button, cx, v2Focus } from './ui'
import { FloatingPanel, insideFloating } from './Floating'

/*
 * The one date filter for every v2 list: All time (optional) · Today ·
 * Yesterday · This month · a chosen month · a chosen day or range from a
 * calendar. Today is the default everywhere unless the page says otherwise.
 *
 * Sits inside a QueryForm and rides along as hidden inputs (mode, month,
 * from, to), or with `autoSubmit` pushes the choice into the URL itself,
 * keeping every other param on the page.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const pad = (n: number) => String(n).padStart(2, '0')
export const toYMD = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const fromYMD = (v: string): Date | undefined => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined
  const [y, m, d] = v.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Calendar sizing and colours on the v2 palette; the library's defaults are page-sized. */
export const CALENDAR_VARS = {
  '--rdp-accent-color': 'var(--color-v2-brand)',
  '--rdp-accent-background-color': 'var(--color-v2-brand-soft)',
  '--rdp-range_middle-background-color': 'var(--color-v2-brand-soft)',
  '--rdp-range_start-date-background-color': 'var(--color-v2-brand)',
  '--rdp-range_end-date-background-color': 'var(--color-v2-brand)',
  '--rdp-selected-border': '2px solid var(--color-v2-brand)',
  '--rdp-today-color': 'var(--color-v2-brand)',
  '--rdp-day-height': '32px',
  '--rdp-day-width': '32px',
  '--rdp-day_button-height': '30px',
  '--rdp-day_button-width': '30px',
  '--rdp-day_button-border-radius': '999px',
  '--rdp-nav-height': '2rem',
  '--rdp-nav_button-height': '1.6rem',
  '--rdp-nav_button-width': '1.6rem',
  '--rdp-weekday-padding': '0.25rem 0',
  '--rdp-font-family': 'inherit',
} as CSSProperties

export function Popover({ children, className, style, align = 'auto' }: { children: ReactNode; className?: string; style?: CSSProperties; align?: 'auto' | 'left' | 'right' }) {
  // Placed beside its parent (the button's wrapper), drawn on the page so no
  // card or scrolling box around the filter can cut it off. See Floating.tsx.
  const marker = useRef<HTMLSpanElement>(null)
  const getAnchor = useCallback(() => marker.current?.parentElement ?? null, [])
  return (
    <>
      <span ref={marker} hidden />
      <FloatingPanel
        getAnchor={getAnchor}
        align={align === 'right' ? 'end' : 'start'}
        className={cx('rounded-v2-lg border border-v2-line bg-v2-surface p-3 text-v2-ink shadow-v2-pop', className)}
        style={style}
      >
        {children}
      </FloatingPanel>
    </>
  )
}

export function fmtDay(v: string): string {
  const d = fromYMD(v)
  return d ? `${d.getDate()} ${MONTHS[d.getMonth()]}` : v
}

export function DateFilter({
  mode: initialMode,
  month: initialMonth,
  from: initialFrom,
  to: initialTo,
  allowAll = false,
  autoSubmit = false,
  carryUnchanged = true,
  size = 'md',
  simple = false,
  inactive = false,
  extra,
  className,
}: {
  mode: DateFilterMode
  month: string
  from: string
  to: string
  allowAll?: boolean
  autoSubmit?: boolean
  /** False keeps the hidden inputs out until a chip is picked, so the page's own default applies. */
  carryUnchanged?: boolean
  size?: 'sm' | 'md' | 'lg'
  /** Only the everyday choices (All time, Today, Yesterday, Pick dates): no month picking. */
  simple?: boolean
  /** Nothing shown as picked: the page is on a choice this control does not own (e.g. "Coming days"). */
  inactive?: boolean
  /** Extra choices drawn inside the same group, after the built-in ones. */
  extra?: ReactNode
  className?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startNav] = useNavTransition()

  const [mode, setMode] = useState<DateFilterMode>(initialMode)
  const [month, setMonth] = useState(initialMonth)
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(initialTo)
  const [touched, setTouched] = useState(false)
  const [panel, setPanel] = useState<'month' | 'dates' | null>(null)
  const [year, setYear] = useState(() => Number((initialMonth || initialFrom || `${new Date().getFullYear()}`).slice(0, 4)))
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!panel) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node) && !insideFloating(e.target)) setPanel(null)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPanel(null)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [panel])

  function apply(next: { mode: DateFilterMode; month?: string; from?: string; to?: string }) {
    const m = next.month ?? ''
    const f = next.from ?? ''
    const t = next.to ?? ''
    setTouched(true)
    setMode(next.mode)
    setMonth(m)
    setFrom(f)
    setTo(t)
    setPanel(null)
    if (!autoSubmit) return
    const params = new URLSearchParams(searchParams.toString())
    params.set('mode', next.mode)
    for (const [k, v] of [['month', m], ['from', f], ['to', t]] as const) {
      if (v) params.set(k, v)
      else params.delete(k)
    }
    params.delete('page')
    startNav(() => router.push(`${pathname}?${params.toString()}`, { scroll: false }))
  }

  const chips: { value: DateFilterMode; label: string }[] = [
    ...(allowAll ? [{ value: 'all' as const, label: 'All time' }] : []),
    { value: 'today', label: 'Today' },
    { value: 'yesterday', label: 'Yesterday' },
    ...(simple ? [] : [{ value: 'month' as const, label: 'This month' }]),
  ]
  const monthLabel = mode === 'custom-month' && month ? `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}` : 'Month'
  const datesLabel =
    mode === 'range' && from ? (to && to !== from ? `${fmtDay(from)} – ${fmtDay(to)}` : fmtDay(from)) : 'Pick dates'
  const pending: DateRange | undefined = mode === 'range' && (from || to) ? { from: fromYMD(from), to: fromYMD(to) } : undefined

  const seg = (active: boolean) =>
    cx(
      'rounded-full font-semibold transition-colors whitespace-nowrap',
      size === 'sm' ? 'px-2.5 py-1 text-[12.5px]' : size === 'lg' ? 'px-4 py-2 text-[14.5px]' : 'px-3 py-1.5 text-[13px]',
      active && !inactive ? 'bg-v2-ink text-v2-bg' : 'text-v2-ink-2 hover:bg-v2-surface-2',
      v2Focus,
    )

  return (
    <div ref={root} className={cx('relative inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-full border border-v2-line bg-v2-surface p-0.5', className)} role="group" aria-label="Dates">
      {chips.map((c) => (
        <button key={c.value} type="button" aria-pressed={mode === c.value} onClick={() => apply({ mode: c.value })} className={seg(mode === c.value)}>
          {c.label}
        </button>
      ))}

      <span className={cx('relative', simple && 'hidden')}>
        <button type="button" aria-pressed={mode === 'custom-month'} aria-haspopup="dialog" aria-expanded={panel === 'month'} onClick={() => setPanel((p) => (p === 'month' ? null : 'month'))} className={seg(mode === 'custom-month')}>
          {monthLabel}
        </button>
        {panel === 'month' ? (
          <Popover className="w-64">
            <div className="mb-2 flex items-center justify-between">
              <button type="button" aria-label="Previous year" onClick={() => setYear((y) => y - 1)} className={cx('grid h-7 w-7 place-items-center rounded-full hover:bg-v2-surface-2', v2Focus)}>
                <ChevronLeft size={16} aria-hidden />
              </button>
              <span className="text-sm font-bold tabular-nums">{year}</span>
              <button type="button" aria-label="Next year" onClick={() => setYear((y) => y + 1)} className={cx('grid h-7 w-7 place-items-center rounded-full hover:bg-v2-surface-2', v2Focus)}>
                <ChevronRight size={16} aria-hidden />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {MONTHS.map((label, i) => {
                const value = `${year}-${pad(i + 1)}`
                const active = mode === 'custom-month' && month === value
                return (
                  <button key={value} type="button" aria-pressed={active} onClick={() => apply({ mode: 'custom-month', month: value })} className={cx('rounded-lg px-2 py-2 text-xs font-semibold transition-colors', active ? 'bg-v2-brand text-white' : 'hover:bg-v2-surface-2', v2Focus)}>
                    {label}
                  </button>
                )
              })}
            </div>
          </Popover>
        ) : null}
      </span>

      <span className="relative">
        <button type="button" aria-pressed={mode === 'range'} aria-haspopup="dialog" aria-expanded={panel === 'dates'} onClick={() => setPanel((p) => (p === 'dates' ? null : 'dates'))} className={cx(seg(mode === 'range'), 'inline-flex items-center gap-1.5')}>
          <CalendarDays size={14} strokeWidth={1.9} aria-hidden />
          {datesLabel}
        </button>
        {panel === 'dates' ? (
          <Popover style={CALENDAR_VARS} className="text-xs">
            <Calendar
              mode="range"
              selected={pending}
              defaultMonth={pending?.from ?? new Date()}
              weekStartsOn={1}
              onSelect={(range) => {
                // Two clicks make a range; a single day is applied as from = to.
                setMode('range')
                setFrom(range?.from ? toYMD(range.from) : '')
                setTo(range?.to ? toYMD(range.to) : '')
              }}
            />
            <div className="mt-1 flex items-center justify-between gap-2 border-t border-v2-line pt-2">
              <span className="text-[11px] text-v2-muted">{from && to && from !== to ? `${fmtDay(from)} to ${fmtDay(to)}` : from ? `${fmtDay(from)} only` : 'Pick a day, or a start and an end'}</span>
              <span className="flex gap-1.5">
                {from ? (
                  <Button type="button" size="sm" variant="ghost" onClick={() => { setFrom(''); setTo('') }}>
                    Clear
                  </Button>
                ) : null}
                <Button type="button" size="sm" variant="primary" disabled={!from} onClick={() => apply({ mode: 'range', from, to: to || from })}>
                  Apply
                </Button>
              </span>
            </div>
          </Popover>
        ) : null}
      </span>

      {extra}

      {carryUnchanged || touched ? (
        <>
          <input type="hidden" name="mode" value={mode} readOnly />
          {mode === 'custom-month' && month ? <input type="hidden" name="month" value={month} readOnly /> : null}
          {mode === 'range' && from ? <input type="hidden" name="from" value={from} readOnly /> : null}
          {mode === 'range' && (to || from) ? <input type="hidden" name="to" value={to || from} readOnly /> : null}
        </>
      ) : null}
    </div>
  )
}
