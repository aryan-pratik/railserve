'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { formatIST, formatTimeIST } from '@/lib/format'
import { IconCheck, IconCheckDouble } from '@/components/Icons'
import { Spinner, focusRingInset } from '@/components/ui'
import { initialsOf, RAIL_PAGE, type ConversationRowView } from './chatView'

/**
 * The scrolling list of threads, WhatsApp-style: one long list that fetches
 * the next page as the reader nears the bottom, instead of a pager.
 *
 * The first page arrives server-rendered, so the screen is complete on first
 * paint and works with scripting off. Each time the live feed re-renders the
 * page, the fresh first page arrives as new props; rather than drop what was
 * scrolled to, the rail refetches as many rows as it already holds, so the
 * list updates in place and the scroll position stays where it was.
 *
 * Opening a thread is a navigation to /…/chat/[id], and a new [id] is a new
 * page segment, so React mounts a brand-new rail: back at the top, with only
 * the first page loaded. That is what used to throw the reader back to the
 * first chat every time they opened one further down. The rail therefore
 * keeps what it had loaded and how far it was scrolled in `memory`, keyed by
 * console and filter, and a fresh mount starts from there instead.
 */

type RailMemory = { rows: ConversationRowView[]; hasMore: boolean; scrollTop: number }

// Module scope, so it outlives the remount but not a reload: a reload should
// land on a fresh list. Keyed by console and search/filter, since a rail
// scrolled under one filter says nothing about another.
const memory = new Map<string, RailMemory>()

export function ConversationRail({
  initial,
  initialHasMore,
  query,
  basePath,
  activeId,
  threadHrefSuffix,
}: {
  initial: ConversationRowView[]
  initialHasMore: boolean
  /** The rail's search and filter, already as a query string (no leading ?). */
  query: string
  basePath: string
  activeId?: string
  /** Appended to every thread link so the filters survive the navigation. */
  threadHrefSuffix: string
}) {
  const memoryKey = `${basePath}?${query}`
  // What this rail had before the navigation remounted it, if anything.
  // Read once, at mount: after that the rail's own state is the truth.
  const [remembered] = useState(() => {
    const m = memory.get(memoryKey)
    return m && m.rows.length > initial.length ? m : null
  })
  const [rows, setRows] = useState(remembered?.rows ?? initial)
  const [hasMore, setHasMore] = useState(remembered?.hasMore ?? initialHasMore)
  const listRef = useRef<HTMLOListElement>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const sentinelRef = useRef<HTMLDivElement>(null)
  // Mirrors `rows` for the effects below, which must read the count as it
  // was before a state reset without depending on it. Declared first so it
  // is current before any later effect in the same commit reads it.
  const rowsRef = useRef(rows)
  useEffect(() => {
    rowsRef.current = rows
  }, [rows])

  useEffect(() => {
    const prev = memory.get(memoryKey)
    memory.set(memoryKey, { rows, hasMore, scrollTop: prev?.scrollTop ?? 0 })
  }, [memoryKey, rows, hasMore])

  // Before paint, put the list back where the reader left it, then make sure
  // the open thread's row is on screen (it is, after a click; it may not be
  // after a deep link or a reload).
  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = memory.get(memoryKey)?.scrollTop ?? 0
    const row = activeId ? el.querySelector<HTMLElement>(`[data-id="${CSS.escape(activeId)}"]`) : null
    if (!row) return
    // The list is `relative`, so a row's offsetTop is measured from it.
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

  const url = useCallback(
    (skip: number, limit: number) =>
      `/api/chat/conversations?${query ? `${query}&` : ''}skip=${skip}&limit=${limit}`,
    [query],
  )

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
    // Keyed on the server's page identity, not on `rows`, or it would refetch itself forever.
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
        // Offset paging can hand back a row that moved up since the last page.
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
      // Start fetching a screen early, so the reader never sees the bottom.
      { rootMargin: '320px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, loadMore])

  const today = formatIST(new Date()).split(',')[0]

  return (
    <ol
      ref={listRef}
      onScroll={onScroll}
      className="relative min-h-0 flex-1 overflow-y-auto [overscroll-behavior:contain] [scrollbar-width:thin]"
    >
      {rows.map((c) => {
        const active = c.id === activeId
        const unread = c.unread > 0
        const day = formatIST(c.at).split(',')[0]
        return (
          <li key={c.id} data-id={c.id} className="group">
            <Link
              href={`${basePath}/${c.id}${threadHrefSuffix}`}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-3 px-3 py-2 transition-colors ${focusRingInset} ${
                active ? 'bg-accent-soft/70' : 'hover:bg-sunken/70'
              }`}
            >
              <span
                aria-hidden
                className={`flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                  active ? 'bg-accent text-white' : unread ? 'bg-accent-soft text-accent' : 'bg-sunken text-muted'
                }`}
              >
                {initialsOf(c.name)}
              </span>
              {/* The divider starts at the text, not the avatar, as every
                  messaging app draws it: the avatars read as one column. */}
              <span className="min-w-0 flex-1 border-b border-line py-1.5 group-last:border-b-0">
                <span className="flex items-baseline justify-between gap-2">
                  <span className={`truncate text-[15px] leading-5 ${unread ? 'font-semibold text-ink' : 'font-medium text-ink'}`}>
                    {c.name}
                  </span>
                  <span
                    className={`shrink-0 text-[11px] tabular-nums ${unread ? 'font-semibold text-accent' : 'text-faint'}`}
                    title={formatIST(c.at)}
                  >
                    {day === today ? formatTimeIST(c.at) : day}
                  </span>
                </span>
                <span className="mt-0.5 flex items-center justify-between gap-2">
                  <span className={`flex min-w-0 items-center gap-1 text-[13px] leading-5 ${unread ? 'text-ink' : 'text-muted'}`}>
                    {c.previewDirection === 'OUT' ? (
                      <IconCheckDouble size={14} aria-label="You: " className="shrink-0 text-faint" />
                    ) : null}
                    <span className="truncate">{c.preview ?? c.phone}</span>
                  </span>
                  {unread ? (
                    <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-bold tabular-nums leading-none text-white">
                      {c.unread}
                    </span>
                  ) : null}
                </span>
                {c.outlet || c.assignee ? (
                  <span className="mt-0.5 block truncate text-[11px] leading-4 text-faint">
                    {[c.outlet, c.assignee].filter(Boolean).join(' · ')}
                  </span>
                ) : null}
              </span>
            </Link>
          </li>
        )
      })}

      <li ref={sentinelRef as never} aria-hidden={!loading && !failed} className="flex justify-center py-3 text-xs text-faint">
        {loading ? (
          <Spinner size={14} className="text-faint" />
        ) : failed ? (
          <button type="button" onClick={() => void loadMore()} className="underline-offset-2 hover:underline">
            Could not load more. Try again
          </button>
        ) : hasMore ? null : rows.length > RAIL_PAGE ? (
          <span className="inline-flex items-center gap-1">
            <IconCheck size={12} aria-hidden /> That is every conversation
          </span>
        ) : null}
      </li>
    </ol>
  )
}
