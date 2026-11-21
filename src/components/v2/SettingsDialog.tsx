'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cx, v2Focus } from './ui'

/*
 * The v2 floating panel: a white card with the pop shadow over a dimmed
 * canvas. `dialog` for a form, `alert` for a question with two buttons.
 * Escape closes, focus lands inside on open and returns to the opener after,
 * the page behind does not scroll.
 */
export function SettingsDialog({
  title,
  titleId,
  onClose,
  children,
  footer,
  width = 'md',
  kind = 'dialog',
}: {
  title: ReactNode
  titleId: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: 'sm' | 'md' | 'lg'
  kind?: 'dialog' | 'alert'
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Focus and scroll lock run once per open; see Modal.tsx for why they must
  // not share an effect with the Escape handler (an inline onClose re-created
  // on each render would pull focus out of the field being typed in).
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

  const maxW = width === 'sm' ? 'max-w-sm' : width === 'lg' ? 'max-w-3xl' : 'max-w-xl'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center whitespace-normal bg-v2-ink/40 p-4 text-left font-v2 text-sm font-normal text-v2-ink" onClick={onClose}>
      <div
        ref={panelRef}
        tabIndex={-1}
        role={kind === 'alert' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className={cx(
          'flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-v2-xl border border-v2-line bg-v2-surface shadow-v2-pop outline-none',
          maxW,
        )}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 px-5 pt-4 pb-3">
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
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 [overscroll-behavior:contain]">{children}</div>
        {footer ? <div className="shrink-0 border-t border-v2-line px-5 py-3">{footer}</div> : null}
      </div>
    </div>
  )
}
