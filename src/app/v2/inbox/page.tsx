import Link from 'next/link'
import { requirePermission } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { resolveDateRange, type DateFilterMode } from '@/lib/dateFilter'
import { inboxFilterParams, isFiltered, readInboxFilter, type InboxFilter, type InboxReason } from '@/lib/inbox'
import { REASON_SHORT, loadInboxPage } from '@/lib/v2/inbox'
import { EmptyState, PageHeader, Pagination, PillTabs, readPaging } from '@/components/v2/Table'
import { Card, cx } from '@/components/v2/ui'
import { InboxFilterBar } from '@/components/v2/InboxFilterBar'
import { InboxQueue } from '@/components/v2/InboxQueue'
import { InboxPasteCard } from '@/components/v2/InboxPasteCard'

export const metadata = { title: 'Inbox · RailServe' }

export default async function V2InboxPage(props: PageProps<'/v2/inbox'>) {
  const ctx = await requirePermission('inbox.review')
  const sp = await props.searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null
  const str = (k: string) => (one(sp[k]) ?? '').trim()
  // The shared date chips. Opens on all time: an unparsed email from last
  // week must not vanish behind a day window. Bare from/to in the URL (an
  // old link, the queue's own query) read as a range.
  const rawMode = str('mode')
  const mode = (rawMode || (str('from') || str('to') ? 'range' : 'all')) as DateFilterMode
  const month = str('month')
  const range = resolveDateRange(mode, { month, from: str('from'), to: str('to') })
  const parsed = readInboxFilter(sp)
  const filter: InboxFilter = mode === 'range' ? parsed : { ...parsed, from: range.from || null, to: range.to || null }
  const { page, pageSize, skip } = readPaging(sp)

  await connectDb()
  // A stalled mailbox is shown by the warning icon in the top bar.
  const data = await loadInboxPage(ctx, filter, { skip, pageSize })

  // The queue's "all matching" query reads from/to as readInboxFilter does;
  // the page's own links carry the mode instead, so a reload shows the chip.
  const params = inboxFilterParams(filter)
  const linkParams = new URLSearchParams(params)
  if (mode !== 'all') {
    linkParams.set('mode', mode)
    if (mode === 'custom-month' && month) linkParams.set('month', month)
    if (mode !== 'range') {
      linkParams.delete('from')
      linkParams.delete('to')
    }
  }
  const href = (u: URLSearchParams) => {
    const s = u.toString()
    return s ? `/v2/inbox?${s}` : '/v2/inbox'
  }
  const withPage = (t: { page: number; pageSize: number }) => {
    const u = new URLSearchParams(linkParams)
    if (t.page > 1) u.set('page', String(t.page))
    if (t.pageSize !== 20) u.set('pageSize', String(t.pageSize))
    return href(u)
  }
  const withReason = (reason: InboxReason | null) => {
    const u = new URLSearchParams(linkParams)
    if (reason) u.set('reason', reason)
    else u.delete('reason')
    return href(u)
  }
  const filtered = isFiltered(filter) || mode !== 'all'

  return (
    <div className="grid gap-[18px]">
      <PageHeader
        title="Emails to check"
        note="Order emails the system could not read on its own. Open each one and add the order by hand if it is real."
      />

      <div className="grid gap-2.5">
        <PillTabs
          tabs={[
            { href: '/v2/inbox', label: 'Needs attention', count: data.openCount, active: !filter.resolved, tone: 'bad' },
            { href: '/v2/inbox?show=resolved', label: 'Resolved', active: filter.resolved },
          ]}
        />
        <nav aria-label="Reason" className="flex flex-wrap items-center gap-1.5 text-xs">
          <ReasonChip href={withReason(null)} label="All reasons" count={data.reasonTotal} active={!filter.reason} warm={!filter.resolved} />
          {data.reasonCounts.map((r) => (
            <ReasonChip key={r.reason} href={withReason(r.reason)} label={REASON_SHORT[r.reason]} count={r.count} active={filter.reason === r.reason} warm={!filter.resolved} />
          ))}
        </nav>
      </div>

      <Card>
        <InboxFilterBar filter={filter} dates={{ mode, month, from: filter.from ?? '', to: filter.to ?? '' }} sources={data.sourceOptions} senders={data.senderOptions} />
      </Card>

      {data.rows.length === 0 ? (
        <EmptyState
          title={filtered ? 'No emails match these filters' : filter.resolved ? 'Nothing resolved yet' : 'Nothing needs attention'}
          note={
            filtered
              ? 'Clear a filter to see more.'
              : filter.resolved
                ? 'Emails you correct, re-ingest or dismiss appear here, with who closed them and how.'
                : 'Every email that fails to parse lands here. A rising count is how a broken parser announces itself.'
          }
          action={
            filtered ? (
              <Link href={filter.resolved ? '/v2/inbox?show=resolved' : '/v2/inbox'} className="text-sm font-semibold text-v2-brand">
                Clear filters
              </Link>
            ) : undefined
          }
        />
      ) : (
        <InboxQueue
          key={`${params.toString()}|${page}|${pageSize}`}
          rows={data.rows}
          total={data.total}
          resolved={filter.resolved}
          query={params.toString()}
          openId={one(sp.open)}
          pager={<Pagination page={page} pageSize={pageSize} total={data.total} buildHref={withPage} />}
        />
      )}

      <InboxPasteCard />
    </div>
  )
}

/** `warm` paints a non-zero count red: open rows are a problem, resolved ones are history. */
function ReasonChip({ href, label, count, active, warm }: { href: string; label: string; count: number; active: boolean; warm: boolean }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? 'true' : undefined}
      className={cx(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 font-semibold transition-colors',
        active ? 'border-v2-ink bg-v2-ink text-v2-bg' : 'border-v2-line bg-v2-surface text-v2-ink-2 hover:bg-v2-surface-2',
      )}
    >
      {label}
      <span className={cx('font-mono tabular-nums', active ? 'opacity-70' : warm && count > 0 ? 'text-v2-bad' : 'text-v2-faint')}>{count}</span>
    </Link>
  )
}
