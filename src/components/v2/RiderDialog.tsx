'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cx, v2Focus } from './ui'

/**
 * The v2 floating panel the rider screens use for forms and confirms: a
 * white card with the pop shadow over a dimmed page. Escape closes, focus
 * lands inside on open and returns to the opener on close, and the page
 * behind cannot scroll. Same contract as `@/components/Modal`, v2 skin.
 */
export function RiderDialog({
  title,
  titleId,
  note,
  onClose,
  children,
  footer,
  width = 'max-w-lg',
  role = 'dialog',
}: {
  title: ReactNode
  titleId: string
  note?: ReactNode
  onClose: () => void
  children: ReactNode
  /** Pinned under the scrolling body, so the primary action never scrolls away. */
  footer?: ReactNode
  width?: string
  role?: 'dialog' | 'alertdialog'
}) {
  const panel = useRef<HTMLDivElement>(null)

  // Focus and scroll-lock run once per open; the Escape handler below is
  // rebound whenever `onClose` changes, so an inline callback never steals
  // focus from a field mid-typing.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    panel.current?.focus()
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

  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-v2-ink/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        ref={panel}
        tabIndex={-1}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className={cx(
          'flex max-h-[calc(100dvh-1rem)] w-full flex-col overflow-hidden rounded-t-v2-xl border border-v2-line bg-v2-surface font-v2 text-v2-ink shadow-v2-pop outline-none sm:max-h-[calc(100dvh-2rem)] sm:rounded-v2-xl',
          width,
        )}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-v2-line px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[17px] font-bold tracking-[-0.01em]">
              {title}
            </h2>
            {note ? <p className="mt-0.5 text-[12.5px] text-v2-muted">{note}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-full text-v2-muted hover:bg-v2-surface-2 hover:text-v2-ink', v2Focus)}
          >
            <X size={16} strokeWidth={2} aria-hidden />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 [overscroll-behavior:contain]">{children}</div>
        {footer ? <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-v2-line px-5 py-3">{footer}</footer> : null}
      </div>
    </div>
  )
}

/** The v2 text input and select, shared by the rider dialogs. */
export { riderInputClass } from '@/lib/v2/ridersShared'

export function RiderField({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="grid gap-1.5">
      <span className="text-[12.5px] font-semibold text-v2-ink-2">{label}</span>
      {children}
      {hint ? <span className="text-xs text-v2-muted">{hint}</span> : null}
    </label>
  )
}

/** The sentence under a form after it posts. */
export function RiderFormNote({ state, className }: { state: { error?: string; ok?: string }; className?: string }) {
  if (state.error) {
    return (
      <p role="alert" className={cx('text-sm font-medium text-v2-bad', className)}>
        {state.error}
      </p>
    )
  }
  if (state.ok) {
    return (
      <p role="status" className={cx('text-sm font-medium text-v2-ok', className)}>
        {state.ok}
      </p>
    )
  }
  return null
}
