'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cx, v2Focus } from './ui'

/*
 * Menus and popups that can never be cut off.
 *
 * A popup positioned inside its card is clipped by any ancestor that scrolls
 * or hides overflow (a train card, a table, the settings column). These are
 * drawn on the page itself instead, fixed to the screen beside the thing that
 * opened them: below it if they fit, above if not, always inside the window,
 * and moved along when the page or a box inside it scrolls.
 */

const MARK = 'data-floating-panel'

/**
 * Whether a click landed inside a floating panel. Outside-click handlers use
 * it, since a panel drawn on the page is not inside the component's own box.
 */
export function insideFloating(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${MARK}]`) !== null
}

export function FloatingPanel({
  getAnchor,
  align = 'start',
  gap = 8,
  matchWidth = false,
  className,
  style,
  role = 'dialog',
  label,
  children,
}: {
  /** The element the panel sits beside; read again on every scroll. */
  getAnchor: () => HTMLElement | null
  /** Line up the panel's left edge (start) or right edge (end) with the anchor's. */
  align?: 'start' | 'end'
  gap?: number
  /** At least as wide as the anchor: dropdowns. */
  matchWidth?: boolean
  className?: string
  style?: CSSProperties
  role?: string
  label?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const layout = () => {
      const anchor = getAnchor()
      if (!anchor) return
      const a = anchor.getBoundingClientRect()
      const edge = 8
      const vw = window.innerWidth
      const vh = window.innerHeight
      if (matchWidth) el.style.minWidth = `${a.width}px`
      const w = el.offsetWidth
      const h = el.offsetHeight
      let top = a.bottom + gap
      if (top + h > vh - edge) top = a.top - gap - h >= edge ? a.top - gap - h : Math.max(edge, vh - h - edge)
      let left = align === 'end' ? a.right - w : a.left
      left = Math.max(edge, Math.min(left, vw - w - edge))
      el.style.top = `${Math.round(top)}px`
      el.style.left = `${Math.round(left)}px`
      el.style.visibility = 'visible'
    }
    layout()
    let frame = 0
    const again = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(layout)
    }
    // A panel that changes size (a month picker turning a page) is placed again.
    const ro = new ResizeObserver(again)
    ro.observe(el)
    window.addEventListener('scroll', again, true)
    window.addEventListener('resize', again)
    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
      window.removeEventListener('scroll', again, true)
      window.removeEventListener('resize', again)
    }
  }, [getAnchor, align, gap, matchWidth])

  // Panels only open after someone taps, so there is always a document.
  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      ref={ref}
      {...{ [MARK]: '' }}
      role={role}
      aria-label={label}
      style={{ ...style, position: 'fixed', top: 0, left: 0, visibility: 'hidden' }}
      className={cx('z-[80] max-h-[calc(100dvh-16px)] max-w-[calc(100vw-16px)] overflow-auto', className)}
    >
      {children}
    </div>,
    document.body,
  )
}

/**
 * A button that opens a small menu. Closes on a click outside, on Escape,
 * and after following a link in it. `children` may be server-rendered links.
 */
export function MenuButton({
  label,
  ariaLabel,
  buttonClassName,
  panelClassName,
  align = 'end',
  children,
}: {
  label: ReactNode
  ariaLabel?: string
  buttonClassName?: string
  panelClassName?: string
  align?: 'start' | 'end'
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const getAnchor = useCallback(() => button.current, [])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (button.current?.contains(e.target as Node) || insideFloating(e.target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        button.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className={cx(buttonClassName, v2Focus)}
      >
        {label}
      </button>
      {open ? (
        <FloatingPanel getAnchor={getAnchor} align={align} role="menu" label={ariaLabel}>
          <div
            onClick={(e) => {
              // A link, or an item marked data-menu-close, is done with the menu.
              if ((e.target as Element).closest('a,[data-menu-close]')) setOpen(false)
            }}
            className={cx('grid gap-0.5 rounded-v2-md border border-v2-line bg-v2-surface p-1.5 shadow-v2-pop', panelClassName)}
          >
            {children}
          </div>
        </FloatingPanel>
      ) : null}
    </>
  )
}
