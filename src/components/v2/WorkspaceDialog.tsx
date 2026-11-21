'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cx, v2Focus } from './ui'

/**
 * The one floating panel on the order workspace: a title, a body, and a row
 * of actions pinned under it. Escape closes, focus lands inside on open and
 * goes back to the opener on close, the page behind cannot scroll. It is the
 * only thing on the page that carries a shadow.
 */
export function WorkspaceDialog({
  title,
  titleId,
  onClose,
  children,
  footer,
  danger = false,
  wide = false,
}: {
  title: ReactNode
  titleId: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /** An alertdialog for anything that ends or removes an order. */
  danger?: boolean
  wide?: boolean
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Focus and scroll lock live for the dialog's lifetime; the Escape handler
  // alone re-binds when onClose changes, so typing never pulls focus away.
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-v2-ink/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        ref={panelRef}
        tabIndex={-1}
        role={danger ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className={cx(
          'flex max-h-[calc(100dvh-1rem)] w-full flex-col overflow-hidden rounded-t-v2-xl border border-v2-line bg-v2-surface font-v2 text-v2-ink shadow-v2-pop outline-none sm:rounded-v2-xl',
          wide ? 'sm:max-w-2xl' : 'sm:max-w-md',
        )}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 px-5 pb-2 pt-4">
          <h2 id={titleId} className="text-[17px] font-bold tracking-[-0.01em]">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={cx('grid h-8 w-8 place-items-center rounded-full text-v2-muted hover:bg-v2-surface-2 hover:text-v2-ink', v2Focus)}
          >
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 text-sm [overscroll-behavior:contain]">{children}</div>
        {footer ? <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-v2-line px-5 py-3">{footer}</div> : null}
      </div>
    </div>
  )
}
