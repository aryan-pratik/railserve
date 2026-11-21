'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { DayPicker as Calendar } from 'react-day-picker'
import 'react-day-picker/style.css'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useNavTransition } from '@/components/navPending'
import { CALENDAR_VARS, Popover, fromYMD, toYMD } from './DateFilter'
import { cx, v2Focus } from './ui'

/**
 * One day at a time: the picker for boards that show a single service day
 * (dashboard, kitchen, call board, riders). Previous / next arrows, a
 * calendar popover, and a "Today" reset. Writes `param` into the URL and
 * keeps everything else; today's value is dropped so the default URL stays
 * clean.
 */
export function DayPicker({
  value,
  today,
  param = 'date',
  max,
  label = 'Day',
  resetKeys = ['page'],
  className,
}: {
  value: string
  today: string
  param?: string
  /** Latest pickable day, as YYYY-MM-DD; omit to allow the future. */
  max?: string
  label?: string
  /** Params to drop when the day changes. */
  resetKeys?: string[]
  className?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startNav] = useNavTransition()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function go(day: string) {
    setOpen(false)
    const params = new URLSearchParams(searchParams.toString())
    if (day === today) params.delete(param)
    else params.set(param, day)
    for (const k of resetKeys) params.delete(k)
    const s = params.toString()
    startNav(() => router.push(s ? `${pathname}?${s}` : pathname, { scroll: false }))
  }

  // Pure date arithmetic from the props; the page supplies `today`, so render
  // never reads the clock and server and client agree.
  const shiftFrom = (base: string, days: number) => {
    const d = fromYMD(base) ?? fromYMD(today)!
    d.setDate(d.getDate() + days)
    return toYMD(d)
  }
  const shift = (days: number) => shiftFrom(value, days)
  const selected = fromYMD(value)
  const isToday = value === today
  const text = isToday
    ? 'Today'
    : value === shiftFrom(today, -1)
      ? 'Yesterday'
      : selected
        ? selected.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
        : value
  const atMax = max ? shift(1) > max : false

  return (
    <div ref={root} className={cx('relative inline-flex items-center rounded-full border border-v2-line bg-v2-surface p-0.5', className)}>
      <button type="button" aria-label="Previous day" onClick={() => go(shift(-1))} className={cx('grid h-8 w-8 place-items-center rounded-full text-v2-muted hover:bg-v2-surface-2 hover:text-v2-ink', v2Focus)}>
        <ChevronLeft size={16} aria-hidden />
      </button>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cx('inline-flex h-8 items-center gap-2 rounded-full px-3 text-[13px] font-semibold', isToday ? 'text-v2-ink-2' : 'bg-v2-ink text-v2-bg', v2Focus)}
      >
        <CalendarDays size={15} strokeWidth={1.9} aria-hidden />
        <span className="sr-only">{label}: </span>
        {text}
      </button>
      <button type="button" aria-label="Next day" disabled={atMax} onClick={() => go(shift(1))} className={cx('grid h-8 w-8 place-items-center rounded-full text-v2-muted hover:bg-v2-surface-2 hover:text-v2-ink disabled:opacity-30', v2Focus)}>
        <ChevronRight size={16} aria-hidden />
      </button>
      {!isToday ? (
        <button type="button" onClick={() => go(today)} className={cx('ml-0.5 h-8 rounded-full px-3 text-[12.5px] font-semibold text-v2-brand hover:bg-v2-brand-soft', v2Focus)}>
          Today
        </button>
      ) : null}
      {open ? (
        <Popover style={CALENDAR_VARS} className="text-xs">
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected ?? fromYMD(today)}
            weekStartsOn={1}
            disabled={max ? { after: fromYMD(max)! } : undefined}
            onSelect={(d) => d && go(toYMD(d))}
          />
        </Popover>
      ) : null}
    </div>
  )
}
