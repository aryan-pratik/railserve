'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { Button } from './ui'

/**
 * The v2 confirm: a question, a sentence of context, a danger button and a
 * way out. Escape cancels, focus lands inside on open and goes back to the
 * opener on close, and the page behind does not scroll.
 */
export function MenuConfirmDialog({
  title,
  titleId,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
  pending = false,
}: {
  title: ReactNode
  titleId: string
  children: ReactNode
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  pending?: boolean
}) {
  const panelRef = useRef<HTMLDivElement>(null)

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
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-v2-ink/40 p-4" onClick={onCancel}>
      <div
        ref={panelRef}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-v2-lg border border-v2-line bg-v2-surface p-5 shadow-v2-pop outline-none [overscroll-behavior:contain]"
      >
        <h3 id={titleId} className="text-[17px] font-bold tracking-[-0.01em] text-balance">
          {title}
        </h3>
        <div className="mt-2 text-sm text-v2-muted text-pretty">{children}</div>
        <div className="mt-4 flex gap-2">
          <Button variant="danger" className="flex-1" onClick={onConfirm} disabled={pending}>
            {confirmLabel}
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}
