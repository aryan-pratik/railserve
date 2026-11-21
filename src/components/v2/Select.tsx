'use client'

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { cx, v2Focus } from './ui'

export type SelectOption = { value: string; label: string; group?: string; disabled?: boolean }

/*
 * The one dropdown for v2. A native <select> hands the menu to the OS, which
 * on macOS centres it on the chosen row and happily draws it off the top of
 * the screen; this one opens inside the viewport (below, or above when there
 * is more room there), scrolls when long, and clamps to the window's edges.
 *
 * Works in a form like a native select: `name` writes a hidden input, and
 * `submitOnChange` submits the surrounding form (QueryForm included).
 * Keyboard: arrows, Home/End, Enter/Space, Escape, and type-ahead.
 */
export function Select({
  options,
  value,
  defaultValue,
  onChange,
  name,
  id,
  placeholder = 'Choose…',
  disabled = false,
  submitOnChange = false,
  size = 'md',
  className,
  buttonClassName,
  'aria-label': ariaLabel,
  align = 'left',
}: {
  options: SelectOption[]
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  name?: string
  id?: string
  placeholder?: string
  disabled?: boolean
  submitOnChange?: boolean
  size?: 'sm' | 'md'
  className?: string
  buttonClassName?: string
  'aria-label'?: string
  align?: 'left' | 'right'
}) {
  const controlled = value !== undefined
  const [inner, setInner] = useState(defaultValue ?? '')
  const current = controlled ? value : inner
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  // The list is a fixed layer placed from the button's screen position, so
  // a scrolling table or an overflow-hidden card can never clip it.
  const [place, setPlace] = useState<{ top: number; left: number; width: number; maxH: number; up: boolean; right: boolean; maxW: number }>({ top: 0, left: 0, width: 0, maxH: 320, up: false, right: false, maxW: 416 })
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const hidden = useRef<HTMLInputElement>(null)
  const typed = useRef({ text: '', at: 0 })
  const listId = useId()

  const selected = options.find((o) => o.value === current)
  const enabled = options.filter((o) => !o.disabled)

  function pick(v: string) {
    if (!controlled) setInner(v)
    onChange?.(v)
    setOpen(false)
    button.current?.focus()
    if (submitOnChange) {
      // The hidden input updates on the next render; submit after it.
      requestAnimationFrame(() => hidden.current?.form?.requestSubmit())
    }
  }

  function measure() {
    const b = button.current
    if (!b) return
    const r = b.getBoundingClientRect()
    const margin = 12
    const below = window.innerHeight - r.bottom - margin
    const above = r.top - margin
    const wanted = Math.min(360, options.length * 36 + 12)
    // Below is the norm. Only open upward when there is genuinely no room
    // for a usable list below and clearly more above; a long list just scrolls.
    const up = below < Math.min(wanted, 200) && above > below * 1.5
    const maxH = Math.max(140, Math.min(wanted, up ? above : below))
    // Anchored to the button's left edge unless that would run off the
    // window, then to its right edge; the list is as wide as its labels need,
    // at least the button's width, at most 26rem or the window.
    const maxW = Math.min(416, window.innerWidth - 2 * margin)
    const anchorRight = r.left + maxW > window.innerWidth - margin && r.right - maxW >= margin
    setPlace({ top: up ? r.top - 6 : r.bottom + 6, left: anchorRight ? r.right : r.left, width: Math.min(r.width, maxW), maxH, up, right: anchorRight, maxW })
  }

  // Placement is measured as the menu opens (an event, not a render), and
  // re-measured while open on any scroll or resize that moves the button.
  function openMenu() {
    measure()
    setCursor(Math.max(0, enabled.findIndex((o) => o.value === current)))
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    const el = list.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor, open])

  function onKey(e: React.KeyboardEvent) {
    if (disabled) return
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      openMenu()
      return
    }
    if (!open) return
    if (e.key === 'Escape') {
      // Closes the menu only; the dialog behind it listens on the document.
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(c + 1, enabled.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(c - 1, 0))
    } else if (e.key === 'Home') {
      e.preventDefault()
      setCursor(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setCursor(enabled.length - 1)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const o = enabled[cursor]
      if (o) pick(o.value)
    } else if (e.key === 'Tab') {
      setOpen(false)
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      const now = e.timeStamp
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + e.key.toLowerCase(), at: now }
      const i = enabled.findIndex((o) => o.label.toLowerCase().startsWith(typed.current.text))
      if (i >= 0) setCursor(i)
    }
  }

  // Group headings, kept in option order.
  const groups: { label: string | undefined; items: SelectOption[] }[] = []
  for (const o of options) {
    const last = groups[groups.length - 1]
    if (last && last.label === o.group) last.items.push(o)
    else groups.push({ label: o.group, items: [o] })
  }
  let flat = -1

  const height = size === 'sm' ? 'h-8 text-[12.5px]' : 'h-10 text-sm'

  return (
    <div ref={root} className={cx('relative min-w-0', className)} onKeyDown={onKey}>
      {name ? <input ref={hidden} type="hidden" name={name} value={current} readOnly /> : null}
      <button
        ref={button}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openMenu())}
        className={cx(
          'inline-flex w-full items-center justify-between gap-2 rounded-full border border-v2-line bg-v2-surface pl-3.5 pr-2.5 text-left text-v2-ink disabled:opacity-50',
          height,
          v2Focus,
          buttonClassName,
        )}
      >
        <span className={cx('truncate', !selected && 'text-v2-faint')}>{selected?.label ?? placeholder}</span>
        <ChevronDown size={16} strokeWidth={1.8} className={cx('shrink-0 text-v2-muted transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open ? (
        <ul
          ref={list}
          id={listId}
          role="listbox"
          aria-activedescendant={enabled[cursor] ? `${listId}-${cursor}` : undefined}
          tabIndex={-1}
          className="fixed z-[70] overflow-y-auto rounded-v2-lg border border-v2-line bg-v2-surface p-1 text-sm shadow-v2-pop [overscroll-behavior:contain]"
          style={{ minWidth: place.width, maxWidth: place.maxW, width: 'max-content', maxHeight: place.maxH, ...(place.right ? { right: window.innerWidth - place.left } : { left: place.left }), ...(place.up ? { bottom: window.innerHeight - place.top } : { top: place.top }) } as CSSProperties}
        >
          {groups.map((g, gi) => (
            <li key={`${g.label ?? ''}-${gi}`} role={g.label ? 'group' : undefined} aria-label={g.label}>
              {g.label ? <div className="px-2.5 pb-1 pt-2 text-[11px] font-bold uppercase tracking-[0.1em] text-v2-faint">{g.label}</div> : null}
              <ul className="m-0 list-none p-0">
                {g.items.map((o) => {
                  const i = o.disabled ? -1 : ++flat
                  const active = i === cursor
                  const isSel = o.value === current
                  return (
                    <li
                      key={o.value}
                      id={i >= 0 ? `${listId}-${i}` : undefined}
                      data-index={i >= 0 ? i : undefined}
                      role="option"
                      aria-selected={isSel}
                      aria-disabled={o.disabled || undefined}
                      onMouseEnter={() => i >= 0 && setCursor(i)}
                      onClick={() => !o.disabled && pick(o.value)}
                      className={cx(
                        'flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-2',
                        o.disabled ? 'cursor-not-allowed text-v2-faint' : active ? 'bg-v2-brand-soft text-v2-ink' : 'text-v2-ink-2',
                        isSel && 'font-semibold',
                      )}
                    >
                      <span className="whitespace-nowrap">{o.label}</span>
                      {isSel ? <Check size={14} className="shrink-0 text-v2-brand" aria-hidden /> : null}
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
          {options.length === 0 ? <li className="px-2.5 py-3 text-center text-v2-muted">No options</li> : null}
        </ul>
      ) : null}
    </div>
  )
}
