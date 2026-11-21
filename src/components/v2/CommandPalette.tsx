'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, CornerDownLeft, ListOrdered, TrainFront, Bike, ArrowRight } from 'lucide-react'
import type { V2NavSection } from './SidebarNav'
import { cx, v2Focus } from './ui'

type Hit = { id: string; title: string; sub: string; href: string; tone?: string; kind: 'order' | 'run' | 'rider' | 'nav' }

/**
 * ⌘K: jump to any order, train run, rider or screen. Searches through
 * /v2/search (the Orders table's own search, scoped to the caller) after a
 * short pause in typing; the sidebar's pages are matched locally.
 */
export function CommandPalette({ nav }: { nav: V2NavSection[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const seq = useRef(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      } else if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const t = setTimeout(() => input.current?.focus(), 20)
    return () => {
      document.body.style.overflow = prev
      clearTimeout(t)
    }
  }, [open])

  const navHits: Hit[] = nav
    .flatMap((s) => s.items)
    .filter((i) => !q || i.label.toLowerCase().includes(q.toLowerCase()))
    .slice(0, q ? 4 : 8)
    .map((i) => ({ kind: 'nav', id: i.href, title: i.label, sub: 'Go to', href: i.href }))

  useEffect(() => {
    if (!open) return
    const term = q.trim()
    // Under two characters nothing is fetched; `shown` below hides stale hits.
    if (term.length < 2) return
    const mine = ++seq.current
    const t = setTimeout(async () => {
      setBusy(true)
      try {
        const r = await fetch(`/v2/search?q=${encodeURIComponent(term)}`, { cache: 'no-store' })
        const data = (await r.json()) as { orders: Hit[]; runs: Hit[]; riders: Hit[] }
        if (mine === seq.current) setHits([...data.orders, ...data.runs, ...data.riders])
      } catch {
        if (mine === seq.current) setHits([])
      } finally {
        if (mine === seq.current) setBusy(false)
      }
    }, 220)
    return () => clearTimeout(t)
  }, [q, open])

  const shown = q.trim().length >= 2 ? hits : []
  const all = [...shown, ...navHits]
  const go = (h: Hit) => {
    setOpen(false)
    setQ('')
    router.push(h.href)
  }

  const groups: { label: string; icon: typeof Search; items: Hit[] }[] = [
    { label: 'Orders', icon: ListOrdered, items: all.filter((h) => h.kind === 'order') },
    { label: 'Trains', icon: TrainFront, items: all.filter((h) => h.kind === 'run') },
    { label: 'Riders', icon: Bike, items: all.filter((h) => h.kind === 'rider') },
    { label: 'Pages', icon: ArrowRight, items: all.filter((h) => h.kind === 'nav') },
  ].filter((g) => g.items.length)
  const ordered = groups.flatMap((g) => g.items)
  const activeHit = ordered[Math.min(active, Math.max(0, ordered.length - 1))]

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cx('hidden flex-[0_1_360px] items-center gap-2.5 rounded-full border border-v2-line bg-v2-surface-2 px-3.5 py-2 text-left text-sm text-v2-faint md:flex', v2Focus)}
      >
        <Search size={18} strokeWidth={1.8} aria-hidden />
        <span className="flex-1">Search order, train, phone</span>
        <kbd className="rounded-md border border-v2-line bg-v2-surface px-1.5 font-mono text-[11px] text-v2-muted">⌘K</kbd>
      </button>
      <button type="button" onClick={() => setOpen(true)} aria-label="Search" className={cx('grid h-10 w-10 place-items-center rounded-full border border-v2-line text-v2-ink-2 md:hidden', v2Focus)}>
        <Search size={18} strokeWidth={1.8} aria-hidden />
      </button>

      {open ? (
        <div className="fixed inset-0 z-[60] grid items-start justify-items-center bg-v2-ink/40 px-4 pt-[10vh]" role="dialog" aria-modal="true" aria-label="Search">
          <button type="button" aria-label="Close search" className="absolute inset-0 cursor-default" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-[620px] overflow-hidden rounded-v2-xl border border-v2-line bg-v2-surface shadow-v2-pop">
            <div className="flex items-center gap-3 border-b border-v2-line px-4">
              <Search size={18} strokeWidth={1.8} className="text-v2-muted" aria-hidden />
              <input
                ref={input}
                id="v2-palette-input"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value)
                  setActive(0)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setActive((a) => Math.min(a + 1, ordered.length - 1))
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setActive((a) => Math.max(a - 1, 0))
                  } else if (e.key === 'Enter' && activeHit) {
                    e.preventDefault()
                    go(activeHit)
                  }
                }}
                placeholder="Order id, passenger, phone, train, seat, rider, or a page"
                autoComplete="off"
                spellCheck={false}
                className="h-14 flex-1 bg-transparent text-[15px] text-v2-ink outline-none placeholder:text-v2-faint"
              />
              {busy ? <span className="h-2 w-2 animate-pulse rounded-full bg-v2-brand" aria-label="Searching" /> : null}
              <kbd className="hidden rounded-md border border-v2-line px-1.5 font-mono text-[11px] text-v2-muted sm:inline">Esc</kbd>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-2">
              {ordered.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-v2-muted">{q.trim().length < 2 ? 'Type to search, or pick a page.' : busy ? 'Searching…' : `Nothing matches “${q}”.`}</p>
              ) : (
                groups.map((g) => (
                  <div key={g.label} className="mb-1">
                    <div className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-[0.1em] text-v2-faint">
                      <g.icon size={12} aria-hidden /> {g.label}
                    </div>
                    {g.items.map((h) => {
                      const isActive = h === activeHit
                      return (
                        <button
                          key={h.kind + h.id}
                          type="button"
                          onMouseEnter={() => setActive(ordered.indexOf(h))}
                          onClick={() => go(h)}
                          className={cx('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left', isActive ? 'bg-v2-brand-soft' : 'hover:bg-v2-surface-2')}
                        >
                          <span className="min-w-0 flex-1">
                            <span className={cx('block truncate text-sm font-semibold', h.kind === 'order' || h.kind === 'run' ? 'font-mono' : '')}>{h.title}</span>
                            <span className="block truncate text-xs text-v2-muted">{h.sub}</span>
                          </span>
                          {h.tone ? <span className="rounded-full bg-v2-surface-2 px-2 py-0.5 text-[11px] font-semibold text-v2-ink-2 ring-1 ring-inset ring-v2-line">{h.tone}</span> : null}
                          {isActive ? <CornerDownLeft size={14} className="text-v2-muted" aria-hidden /> : null}
                        </button>
                      )
                    })}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
