'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cx, v2Focus } from './ui'

/**
 * The v2 floating dialog: a white card with the pop shadow over a dimmed
 * page. Escape and the backdrop close it; focus lands inside on open and
 * returns to the opener on close. Shared by the call board (cancel) and the
 * chat (new chat); both are small forms with one primary action.
 */
export function CallsDialog({
  title,
  titleId,
  onClose,
  children,
  className,
}: {
  title: ReactNode
  titleId: string
  onClose: () => void
  children: ReactNode
  className?: string
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    // Focus the first field if there is one, else the panel, so typing can start at once.
    const first = panelRef.current?.querySelector<HTMLElement>('input, textarea, select, button')
    ;(first ?? panelRef.current)?.focus()
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
      opener?.focus?.()
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-v2-ink/40 p-3 font-v2 text-v2-ink sm:items-center sm:p-4" onClick={onClose}>
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className={cx('w-full max-w-md rounded-v2-lg border border-v2-line bg-v2-surface p-5 shadow-v2-pop outline-none [overscroll-behavior:contain]', className)}
      >
        <header className="mb-3 flex items-start justify-between gap-3">
          <h3 id={titleId} className="text-[17px] font-bold tracking-[-0.01em]">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={cx('-mr-1.5 -mt-1.5 grid h-8 w-8 place-items-center rounded-full text-v2-muted hover:bg-v2-surface-2 hover:text-v2-ink', v2Focus)}
          >
            <X size={16} aria-hidden />
          </button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  )
}

/** Field furniture inside a v2 dialog or inline form. */
export const v2Input =
  'w-full rounded-v2-md border border-v2-line bg-v2-surface px-3 py-2 text-sm text-v2-ink outline-none placeholder:text-v2-faint focus:border-v2-brand focus:ring-2 focus:ring-v2-brand/30 disabled:opacity-60'

export function FormLine({ state, className }: { state: { error?: string; ok?: string }; className?: string }) {
  if (state.error) {
    return (
      <p role="alert" className={cx('text-xs font-medium text-v2-bad', className)}>
        {state.error}
      </p>
    )
  }
  if (state.ok) {
    return (
      <p role="status" className={cx('text-xs font-medium text-v2-ok', className)}>
        {state.ok}
      </p>
    )
  }
  return null
}
