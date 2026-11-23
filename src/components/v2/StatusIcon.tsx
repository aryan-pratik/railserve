'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { cx, v2Focus } from './ui'
import { FloatingPanel, insideFloating } from './Floating'
import { useReportedIssues } from './statusBus'

export type StatusIssue = {
  id: string
  /** red: changes what to do now; amber: worth knowing. */
  level: 'red' | 'amber'
  title: string
  detail: string
  action?: { label: string; href: string }
}

/**
 * Something is wrong with the system itself: shown as one small warning icon
 * in the top bar, never a banner across the page. No problems, no icon.
 * Tap opens the list (hover too, on a desktop). A red problem opens the list
 * once by itself, so a busy person cannot miss it; after closing it stays as
 * a still icon. No animation: a moving icon pulls the eye all shift long.
 */
export function StatusIcon({ issues: fromServer }: { issues: StatusIssue[] }) {
  const reported = useReportedIssues()
  const issues = [...fromServer, ...reported].sort((a, b) => (a.level === b.level ? 0 : a.level === 'red' ? -1 : 1))
  const red = issues.some((i) => i.level === 'red')
  const [open, setOpen] = useState(false)
  const byHover = useRef(false)
  const root = useRef<HTMLDivElement>(null)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const getAnchor = useCallback(() => root.current, [])

  // Red problems announce themselves once per browser session each.
  const redIds = issues.filter((i) => i.level === 'red').map((i) => i.id).join('|')
  useEffect(() => {
    if (!redIds) return
    let seen: string[] = []
    try {
      seen = JSON.parse(sessionStorage.getItem('rs.statusSeen') ?? '[]')
    } catch {}
    const fresh = redIds.split('|').filter((id) => !seen.includes(id))
    if (fresh.length === 0) return
    try {
      sessionStorage.setItem('rs.statusSeen', JSON.stringify([...seen, ...fresh]))
    } catch {}
    const t = setTimeout(() => setOpen(true), 400)
    return () => clearTimeout(t)
  }, [redIds])

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

  if (issues.length === 0) return null

  return (
    <div
      ref={root}
      className="relative"
      onMouseEnter={(e) => {
        if (e.nativeEvent instanceof PointerEvent && e.nativeEvent.pointerType !== 'mouse') return
        // Moving from the icon to the list crosses a small gap: a short
        // grace period keeps the list open on the way.
        if (leaveTimer.current) clearTimeout(leaveTimer.current)
        if (!open) {
          byHover.current = true
          setOpen(true)
        }
      }}
      onMouseLeave={() => {
        if (!byHover.current) return
        leaveTimer.current = setTimeout(() => {
          byHover.current = false
          setOpen(false)
        }, 250)
      }}
    >
      <button
        type="button"
        onClick={() => {
          byHover.current = false
          setOpen((o) => !o)
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${issues.length} problem${issues.length === 1 ? '' : 's'} with the system`}
        className={cx(
          'relative grid h-10 w-10 place-items-center rounded-full border transition-colors',
          red ? 'border-v2-bad/40 bg-v2-bad-bg text-v2-bad' : 'border-v2-warn/40 bg-v2-warn-bg text-v2-warn',
          v2Focus,
        )}
      >
        <AlertTriangle size={18} strokeWidth={2} aria-hidden />
        {issues.length > 1 ? (
          <span className={cx('absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full px-1 font-mono text-[11px] font-bold text-white', red ? 'bg-v2-bad' : 'bg-v2-warn')}>
            {issues.length}
          </span>
        ) : null}
      </button>
      {open ? (
        <FloatingPanel getAnchor={getAnchor} align="end" label="Problems">
        <div className="w-[340px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-v2-lg border border-v2-line bg-v2-surface shadow-v2-pop">
          <ul className="grid gap-1 p-1.5">
            {issues.map((i) => (
              <li key={i.id} className="flex items-start gap-3 rounded-xl px-2.5 py-2.5">
                <span className={cx('mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full', i.level === 'red' ? 'bg-v2-bad-bg text-v2-bad' : 'bg-v2-warn-bg text-v2-warn')}>
                  <AlertTriangle size={14} aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold">{i.title}</span>
                  <span className="block text-[13px] leading-snug text-v2-muted">{i.detail}</span>
                  {i.action ? (
                    <Link href={i.action.href} onClick={() => setOpen(false)} className="mt-1 inline-block text-[13px] font-semibold text-v2-brand hover:underline">
                      {i.action.label}
                    </Link>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
        </FloatingPanel>
      ) : null}
    </div>
  )
}
