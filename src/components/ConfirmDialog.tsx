'use client'

import { useEffect, useRef, type ReactNode } from 'react'

/**
 * The one modal shape this app has: a question, a sentence of context, and
 * two buttons. Escape cancels, focus lands inside on open and returns to the
 * opener on close, and the page behind cannot scroll.
 *
 * The delay guards on the store board and the order page both used to carry
 * their own copy of this markup; the copies had already drifted on focus
 * handling, which is exactly the kind of thing a shared component exists for.
 */
export function ConfirmDialog({
  title,
  titleId,
  children,
  actions,
  onCancel,
}: {
  title: ReactNode
  titleId: string
  children: ReactNode
  actions: ReactNode
  onCancel: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Split for the same reason as Modal's — see the note there. This one holds
  // only buttons today, so the focus-stealing version never visibly broke
  // anything; leaving the loaded gun in the twin is how it recurs.
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={onCancel}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl border border-line bg-surface p-5 shadow-xl outline-none [overscroll-behavior:contain]"
      >
        <h3 id={titleId} className="text-base font-semibold text-ink text-balance">
          {title}
        </h3>
        <div className="mt-2 text-sm text-muted text-pretty">{children}</div>
        <div className="mt-4 flex gap-2">{actions}</div>
      </div>
    </div>
  )
}
