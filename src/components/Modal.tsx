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
}: {
  title: ReactNode
  titleId: string
  children: ReactNode
  onClose: () => void
  maxWidthClassName?: string
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
        className={`w-full ${maxWidthClassName} max-h-[calc(100vh-2rem)] overflow-y-auto rounded-xl border border-line bg-surface shadow-xl outline-none [overscroll-behavior:contain]`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
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
        {children}
      </div>
    </div>
  )
}
