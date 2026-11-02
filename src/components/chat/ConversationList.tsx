import Link from 'next/link'
import type { AuthContext } from '@/lib/authContext'
import { labelsFor, listConversations, type ConversationFilter } from '@/lib/repo/whatsappRepo'
import { IconSearch } from '@/components/Icons'
import { QueryForm } from '@/components/QueryForm'
import { focusRing } from '@/components/ui'
import { NewChatButton } from './NewChatButton'
import { ConversationRail } from './ConversationRail'
import { RAIL_PAGE, toConversationRow } from './chatView'

export type ListParams = Record<string, string | string[] | undefined>

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''

export function readListParams(sp: ListParams) {
  const f = one(sp.filter)
  return {
    q: one(sp.q).trim(),
    filter: (f === 'unread' || f === 'mine' || f === 'unassigned' ? f : 'all') as ConversationFilter,
  }
}

/** The rail's search and filter as a query string, so they survive moving between threads. */
export function listQuery(p: { q: string; filter: ConversationFilter }) {
  const u = new URLSearchParams()
  if (p.q) u.set('q', p.q)
  if (p.filter !== 'all') u.set('filter', p.filter)
  return u
}

/**
 * The rail: every passenger thread in scope, newest activity first, as one
 * scrolling list that loads more as it goes. The first page is rendered
 * here on the server; ConversationRail takes it from there.
 *
 * Deliberately not the shared Pagination the tables use: this is a
 * messaging list, and people have one fixed idea of how those scroll.
 */
export async function ConversationList({
  ctx,
  params,
  activeId,
  basePath,
}: {
  ctx: AuthContext
  params: ListParams
  activeId?: string
  /** The console this rail sits on: '/calls/chat' or '/admin/chat'. */
  basePath: string
}) {
  const p = readListParams(params)
  const { rows, total } = await listConversations(ctx, { q: p.q, filter: p.filter, skip: 0, limit: RAIL_PAGE })
  const labels = await labelsFor(rows)
  const me = String(ctx.userId)
  const query = listQuery(p).toString()

  const filterHref = (filter: ConversationFilter) => {
    const s = listQuery({ ...p, filter }).toString()
    return s ? `${basePath}?${s}` : basePath
  }
  // The manager's extra chip: an admin is the one person who hands threads
  // out, so "nobody has this yet" is a question only they ask.
  const chips: [ConversationFilter, string][] = [
    ['all', 'All'],
    ['unread', 'Unread'],
    ['mine', 'Mine'],
    ...(ctx.role === 'ADMIN' ? ([['unassigned', 'Unassigned']] as [ConversationFilter, string][]) : []),
  ]

  return (
    <>
      <div className="shrink-0 space-y-2.5 border-b border-line px-3 pb-2.5 pt-3">
        <div className="flex items-center gap-2">
          <QueryForm action={basePath} className="relative min-w-0 flex-1">
            {p.filter !== 'all' ? <input type="hidden" name="filter" value={p.filter} /> : null}
            <label htmlFor="chat-q" className="sr-only">
              Find a conversation
            </label>
            <IconSearch size={15} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
            <input
              id="chat-q"
              name="q"
              type="search"
              defaultValue={p.q}
              placeholder="Search or start new chat"
              className={
                'h-10 w-full rounded-full border border-transparent bg-sunken pl-10 pr-4 text-sm text-ink outline-none ' +
                'placeholder:text-faint focus:border-accent focus:bg-surface focus:ring-2 focus:ring-accent'
              }
            />
          </QueryForm>
          <NewChatButton basePath={basePath} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Show">
          {chips.map(([f, label]) => {
            const active = p.filter === f
            return (
              <Link
                key={f}
                href={filterHref(f)}
                aria-current={active ? 'true' : undefined}
                className={`inline-flex h-8 items-center rounded-full px-3 text-xs font-medium transition-colors ${focusRing} ${
                  active ? 'bg-accent-soft text-accent' : 'bg-sunken text-muted hover:bg-line hover:text-ink'
                }`}
              >
                {label}
              </Link>
            )
          })}
          {p.q ? (
            <Link href={filterHref(p.filter)} className={`ml-auto rounded-full px-2 text-xs font-medium text-muted underline-offset-2 hover:underline ${focusRing}`}>
              Clear search
            </Link>
          ) : null}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center">
          <div>
            <p className="text-sm font-medium text-ink">
              {p.q
                ? 'No conversation matches that'
                : p.filter === 'unread'
                  ? 'Nothing unread'
                  : p.filter === 'mine'
                    ? 'Nothing assigned to you'
                    : p.filter === 'unassigned'
                      ? 'Every conversation has someone on it'
                      : 'No conversations yet'}
            </p>
            <p className="mt-1 text-xs text-muted text-pretty">
              {p.q
                ? 'Try the number on its own, without spaces.'
                : 'Open one from the WhatsApp button on an order, or start a new chat with a number.'}
            </p>
          </div>
        </div>
      ) : (
        <ConversationRail
          initial={rows.map((c) => toConversationRow(c, labels, me))}
          initialHasMore={rows.length < total}
          query={query}
          basePath={basePath}
          activeId={activeId}
          threadHrefSuffix={query ? `?${query}` : ''}
        />
      )}
    </>
  )
}
