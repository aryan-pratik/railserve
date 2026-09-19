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

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
      opener?.focus?.()
    }
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
