'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Check, CheckCheck, Loader2 } from 'lucide-react'
import { formatIST, formatTimeIST } from '@/lib/format'
import { initialsOf, RAIL_PAGE, type ConversationRowView } from '@/components/chat/chatView'
import { cx } from '@/components/v2/ui'

const BASE = '/v2/chat'

/**
 * The scrolling list of threads: one long list that fetches the next page as
 * the reader nears the bottom. A fresh first page from the live feed arrives
 * as new props and the rail refetches as many rows as it holds, so the list
 * updates in place. Opening a thread remounts the rail (new route segment),
 * so what was loaded and how far it was scrolled is kept in `memory`, keyed
 * by filter, and a fresh mount starts from there.
 */
type RailMemory = { rows: ConversationRowView[]; hasMore: boolean; scrollTop: number }
const memory = new Map<string, RailMemory>()

export function ChatRail({
  initial,
  initialHasMore,
  query,
  activeId,
  threadHrefSuffix,
}: {
  initial: ConversationRowView[]
  initialHasMore: boolean
  /** The rail's search and filter, already as a query string (no leading ?). */
  query: string
  activeId?: string
  threadHrefSuffix: string
}) {
  const memoryKey = `${BASE}?${query}`
  const [remembered] = useState(() => {
    const m = memory.get(memoryKey)
    return m && m.rows.length > initial.length ? m : null
  })
  const [rows, setRows] = useState(remembered?.rows ?? initial)
  const [hasMore, setHasMore] = useState(remembered?.hasMore ?? initialHasMore)
  const listRef = useRef<HTMLOListElement>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const sentinelRef = useRef<HTMLLIElement>(null)
  const rowsRef = useRef(rows)
  useEffect(() => {
    rowsRef.current = rows
  }, [rows])

  useEffect(() => {
    const prev = memory.get(memoryKey)
    memory.set(memoryKey, { rows, hasMore, scrollTop: prev?.scrollTop ?? 0 })
  }, [memoryKey, rows, hasMore])

  // Before paint: back where the reader left it, with the open thread's row on screen.
  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = memory.get(memoryKey)?.scrollTop ?? 0
    const row = activeId ? el.querySelector<HTMLElement>(`[data-id="${CSS.escape(activeId)}"]`) : null
    if (!row) return
    const top = row.offsetTop
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + row.offsetHeight > el.scrollTop + el.clientHeight) el.scrollTop = top + row.offsetHeight - el.clientHeight
    // Mount only: once open, the reader's own scrolling is not ours to move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onScroll() {
    const el = listRef.current
    const m = memory.get(memoryKey)
    if (el && m) m.scrollTop = el.scrollTop
  }

  const url = useCallback((skip: number, limit: number) => `/api/chat/conversations?${query ? `${query}&` : ''}skip=${skip}&limit=${limit}`, [query])

  // A fresh first page from the server: refetch everything loaded so far.
  useEffect(() => {
    const held = rowsRef.current.length
    if (held <= initial.length) {
      setRows(initial)
      setHasMore(initialHasMore)
      return
    }
    let cancelled = false
    fetch(url(0, held), { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { rows: ConversationRowView[]; hasMore: boolean }) => {
        if (cancelled) return
        setRows(data.rows)
        setHasMore(data.hasMore)
      })
      .catch(() => {
        if (!cancelled) setRows(initial)
      })
    return () => {
      cancelled = true
    }
  }, [initial, initialHasMore, url])

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return
    setLoading(true)
    setFailed(false)
    try {
      const r = await fetch(url(rowsRef.current.length, RAIL_PAGE), { cache: 'no-store' })
      if (!r.ok) throw new Error(String(r.status))
      const data: { rows: ConversationRowView[]; hasMore: boolean } = await r.json()
      setRows((prev) => {
        const seen = new Set(prev.map((p) => p.id))
        return [...prev, ...data.rows.filter((p) => !seen.has(p.id))]
      })
      setHasMore(data.hasMore)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [loading, hasMore, url])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasMore) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore()
      },
      { rootMargin: '320px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, loadMore])

  const today = formatIST(new Date()).split(',')[0]

  return (
    <ol ref={listRef} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto [overscroll-behavior:contain] [scrollbar-width:thin]">
      {rows.map((c) => {
        const active = c.id === activeId
        const unread = c.unread > 0
        const day = formatIST(c.at).split(',')[0]
        return (
          <li key={c.id} data-id={c.id} className="group">
            <Link
              href={`${BASE}/${c.id}${threadHrefSuffix}`}
              aria-current={active ? 'page' : undefined}
              className={cx(
                'flex items-center gap-3 px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-v2-brand',
                active ? 'bg-v2-brand-soft' : 'hover:bg-v2-surface-2',
              )}
            >
              <span
                aria-hidden
                className={cx(
                  'grid h-11 w-11 shrink-0 place-items-center rounded-full text-sm font-bold',
                  active ? 'bg-v2-brand text-white' : unread ? 'bg-v2-brand-soft text-v2-brand' : 'bg-v2-surface-2 text-v2-muted',
                )}
              >
                {initialsOf(c.name)}
              </span>
              {/* The divider starts at the text, not the avatar, as every messaging app draws it. */}
              <span className={cx('min-w-0 flex-1 py-1.5 group-last:border-b-0', active ? '' : 'border-b border-v2-line')}>
                <span className="flex items-baseline justify-between gap-2">
                  <span className={cx('truncate text-[15px] leading-5', unread ? 'font-bold' : 'font-semibold')}>{c.name}</span>
                  <span className={cx('shrink-0 text-[11px] tabular-nums', unread ? 'font-bold text-v2-brand' : 'text-v2-faint')} title={formatIST(c.at)}>
                    {day === today ? formatTimeIST(c.at) : day}
                  </span>
                </span>
                <span className="mt-0.5 flex items-center justify-between gap-2">
                  <span className={cx('flex min-w-0 items-center gap-1 text-[13px] leading-5', unread ? 'text-v2-ink' : 'text-v2-muted')}>
                    {c.previewDirection === 'OUT' ? <CheckCheck size={14} aria-label="You: " className="shrink-0 text-v2-faint" /> : null}
                    <span className="truncate">{c.preview ?? c.phone}</span>
                  </span>
                  {unread ? (
                    <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-v2-brand px-1.5 font-mono text-[11px] font-bold leading-none text-white tabular-nums">
                      {c.unread}
                    </span>
                  ) : null}
                </span>
                {c.outlet || c.assignee ? (
                  <span className="mt-0.5 block truncate text-[11px] leading-4 text-v2-faint">{[c.outlet, c.assignee].filter(Boolean).join(' · ')}</span>
                ) : null}
              </span>
            </Link>
          </li>
        )
      })}

      <li ref={sentinelRef} aria-hidden={!loading && !failed} className="flex justify-center py-3 text-xs text-v2-faint">
        {loading ? (
          <Loader2 size={14} className="animate-spin" aria-hidden />
        ) : failed ? (
          <button type="button" onClick={() => void loadMore()} className="underline-offset-2 hover:underline">
            Could not load more. Try again
          </button>
        ) : hasMore ? null : rows.length > RAIL_PAGE ? (
          <span className="inline-flex items-center gap-1">
            <Check size={12} aria-hidden /> That is every conversation
          </span>
        ) : null}
      </li>
    </ol>
  )
}
