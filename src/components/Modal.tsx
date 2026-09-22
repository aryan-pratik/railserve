'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { IconClose } from './Icons'

/**
 * A general-purpose panel for arbitrary content (a form, mostly) — as opposed
 * to `ConfirmDialog`, which is shaped specifically for a question + two
 * buttons. Same escape/focus/scroll-lock treatment, wider by default.
 */
export function Modal({
  title,
  titleId,
  children,
  onClose,
  maxWidthClassName = 'max-w-lg',
  maxHeightClassName = 'max-h-[calc(100vh-2rem)]',
  footer,
}: {
  title: ReactNode
  titleId: string
  children: ReactNode
  onClose: () => void
  maxWidthClassName?: string
  /** Caps how tall the panel can grow before its own body scrolls. */
  maxHeightClassName?: string
  /**
   * A bar pinned below the scrollable body, outside it rather than inside —
   * so the primary action stays reachable on a long form without hunting for
   * it after a scroll. Omit for a dialog with no action that needs that.
   */
  footer?: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Focus and scroll-lock belong to the modal's lifetime, so they run once and
  // undo once. They used to share an effect with the Escape handler below,
  // which made them depend on the identity of `onClose` — and a caller that
  // declares `onClose` inline re-creates it on every render, so every
  // keystroke in a controlled field re-ran this and pulled focus out of the
  // field and back onto the panel. One character, then a dead keyboard.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
      opener?.focus?.()
    }
  }, [])

  // Only the Escape handler cares which `onClose` is current, and re-binding a
  // listener is free.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className={`flex w-full ${maxWidthClassName} ${maxHeightClassName} flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-xl outline-none`}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 id={titleId} className="text-sm font-semibold text-ink text-balance">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-muted transition-colors hover:bg-sunken hover:text-ink"
          >
            <IconClose size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto [overscroll-behavior:contain]">{children}</div>
        {footer ? (
          <div className="shrink-0 border-t border-line bg-surface px-5 py-3">{footer}</div>
        ) : null}
      </div>
    </div>
  )
}
