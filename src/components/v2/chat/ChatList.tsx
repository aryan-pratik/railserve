import Link from 'next/link'
import { Search } from 'lucide-react'
import type { AuthContext } from '@/lib/authContext'
import { labelsFor, listConversations, type ConversationFilter } from '@/lib/repo/whatsappRepo'
import { RAIL_PAGE, toConversationRow } from '@/components/chat/chatView'
import { QueryForm } from '@/components/QueryForm'
import { cx, v2Focus } from '@/components/v2/ui'
import { ChatNewButton } from './ChatNewButton'
import { ChatRail } from './ChatRail'

export const CHAT_BASE = '/v2/chat'

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
 * scrolling list. The first page renders here on the server; ChatRail loads
 * the rest as the reader nears the bottom. Not the shared Pagination on
 * purpose: this is a messaging list.
 */
export async function ChatList({ ctx, params, activeId }: { ctx: AuthContext; params: ListParams; activeId?: string }) {
  const p = readListParams(params)
  const { rows, total } = await listConversations(ctx, { q: p.q, filter: p.filter, skip: 0, limit: RAIL_PAGE })
  const labels = await labelsFor(ctx, rows)
  const me = String(ctx.userId)
  const query = listQuery(p).toString()

  const filterHref = (filter: ConversationFilter) => {
    const s = listQuery({ ...p, filter }).toString()
    return s ? `${CHAT_BASE}?${s}` : CHAT_BASE
  }
  // The admin's extra chip: the one person who hands threads out asks "nobody has this yet".
  const chips: [ConversationFilter, string][] = [
    ['all', 'All'],
    ['unread', 'Unread'],
    ['mine', 'Mine'],
    ...(ctx.role === 'ADMIN' ? ([['unassigned', 'Unassigned']] as [ConversationFilter, string][]) : []),
  ]

  return (
    <>
      <div className="grid shrink-0 gap-2.5 border-b border-v2-line px-3 pb-2.5 pt-3">
        <div className="flex items-center gap-2">
          <QueryForm action={CHAT_BASE} className="relative min-w-0 flex-1">
            {p.filter !== 'all' ? <input type="hidden" name="filter" value={p.filter} /> : null}
            <label htmlFor="chat-q" className="sr-only">
              Find a conversation
            </label>
            <Search size={15} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-v2-faint" />
            <input
              id="chat-q"
              name="q"
              type="search"
              defaultValue={p.q}
              placeholder="Search name or number"
              className="h-10 w-full rounded-full border border-transparent bg-v2-surface-2 pl-10 pr-4 text-sm text-v2-ink outline-none placeholder:text-v2-faint focus:border-v2-brand focus:bg-v2-surface focus:ring-2 focus:ring-v2-brand/30"
            />
          </QueryForm>
          <ChatNewButton />
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Show">
          {chips.map(([f, label]) => {
            const active = p.filter === f
            return (
              <Link
                key={f}
                href={filterHref(f)}
                aria-current={active ? 'true' : undefined}
                className={cx(
                  'inline-flex h-8 items-center rounded-full border px-3 text-xs font-semibold transition-colors',
                  active ? 'border-v2-ink bg-v2-ink text-v2-bg' : 'border-v2-line bg-v2-surface text-v2-ink-2 hover:bg-v2-surface-2',
                  v2Focus,
                )}
              >
                {label}
              </Link>
            )
          })}
          {p.q ? (
            <Link href={filterHref(p.filter)} className={cx('ml-auto rounded-full px-2 text-xs font-semibold text-v2-brand underline-offset-2 hover:underline', v2Focus)}>
              Clear search
            </Link>
          ) : null}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center">
          <div>
            <p className="text-sm font-bold">
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
            <p className="mt-1 text-xs text-v2-muted">
              {p.q ? 'Try the number on its own, without spaces.' : 'Open one from the WhatsApp button on an order, or start a new chat with a number.'}
            </p>
          </div>
        </div>
      ) : (
        <ChatRail
          initial={rows.map((c) => toConversationRow(c, labels, me))}
          initialHasMore={rows.length < total}
          query={query}
          activeId={activeId}
          threadHrefSuffix={query ? `?${query}` : ''}
        />
      )}
    </>
  )
}
