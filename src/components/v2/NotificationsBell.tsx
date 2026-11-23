'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Bell } from 'lucide-react'
import { cx, v2Focus } from './ui'
import { FloatingPanel, insideFloating } from './Floating'

export type AlertItem = { id: string; title: string; sub: string; href: string; tone: 'bad' | 'warn' | 'info' }

/**
 * The bell: what needs a person right now (cancel requests, bags to collect,
 * emails that did not become orders). Server-computed per role; the
 * dropdown just lists it.
 */
export function NotificationsBell({ items }: { items: AlertItem[] }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const getAnchor = useCallback(() => root.current, [])
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node) && !insideFloating(e.target)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const tones = { bad: 'bg-v2-bad-bg text-v2-bad', warn: 'bg-v2-warn-bg text-v2-warn', info: 'bg-v2-info-bg text-v2-info' }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={items.length ? `${items.length} things need attention` : 'Nothing needs attention'}
        className={cx('relative grid h-10 w-10 place-items-center rounded-full border border-v2-line text-v2-ink-2 hover:bg-v2-surface-2', v2Focus)}
      >
        <Bell size={18} strokeWidth={1.8} aria-hidden />
        {items.length ? <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-v2-bad ring-2 ring-v2-surface" aria-hidden /> : null}
      </button>
      {open ? (
        <FloatingPanel getAnchor={getAnchor} align="end" label="Needs attention">
        <div className="w-[340px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-v2-lg border border-v2-line bg-v2-surface shadow-v2-pop">
          <div className="flex items-center justify-between border-b border-v2-line px-4 py-2.5">
            <span className="text-sm font-bold">Needs attention</span>
            <span className="font-mono text-xs text-v2-muted">{items.length}</span>
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-v2-muted">All clear. Nothing is waiting on you.</p>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto p-1.5">
              {items.map((it) => (
                <li key={it.id}>
                  <Link href={it.href} onClick={() => setOpen(false)} className={cx('flex items-start gap-3 rounded-xl px-2.5 py-2 hover:bg-v2-surface-2', v2Focus)}>
                    <span className={cx('mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-extrabold', tones[it.tone])}>!</span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{it.title}</span>
                      <span className="block truncate text-xs text-v2-muted">{it.sub}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        </FloatingPanel>
      ) : null}
    </div>
  )
}
