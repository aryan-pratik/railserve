import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { UnparsedInbox, User } from '@/lib/models'
import { formatIST } from '@/lib/format'
import { checkIngestStaleness } from '@/lib/ingest/gmail/sync'
import { toParseableText } from '@/lib/ingest/gmail/client'
import { sourceLabel } from '@/lib/orderEnums'
import {
  INBOX_REASONS,
  REASON_LABEL,
  inboxFilterParams,
  inboxQuery,
  isFiltered,
  previewOf,
  readInboxFilter,
  splitSender,
  type InboxReason,
} from '@/lib/inbox'
import { EmptyState, Notice, PageHeader, Tabs, Pagination } from '@/components/ui'
import { readPage, withPage } from '@/lib/pagination'
import { PasteEmailForm } from './InboxForms'
import { InboxFilters } from './InboxFilters'
import { InboxList, type InboxRowView } from './InboxList'

export const metadata = { title: 'Inbox · RailServe' }

export default async function InboxPage(props: PageProps<'/admin/inbox'>) {
  await requireRole('ADMIN')
  const sp = await props.searchParams
  const filter = readInboxFilter(sp)
  const { page, pageSize, skip } = readPage(sp)
  const query = inboxQuery(filter)

  await connectDb()
  // Paged, not capped: this stopped at 100 silently, which on a bad day is
  // exactly when an admin needs to see the 101st broken email.
  const [rows, total, openCount, reasonCounts, sources, senders, ingest] = await Promise.all([
    UnparsedInbox.find(query).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
    UnparsedInbox.countDocuments(query),
    UnparsedInbox.countDocuments({ resolved: false }),
    // Per reason, under every other filter: the chips say what clicking one
    // would leave, not what the whole inbox holds.
    UnparsedInbox.aggregate<{ _id: string; n: number }>([
      { $match: inboxQuery(filter, 'reason') },
      { $group: { _id: '$reason', n: { $sum: 1 } } },
    ]),
    UnparsedInbox.distinct('source', { resolved: filter.resolved }),
    UnparsedInbox.aggregate<{ _id: string | null; n: number }>([
      { $match: { resolved: filter.resolved } },
      { $group: { _id: '$rawPayload.from', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
      { $limit: 200 },
    ]),
    // A lapsed Gmail watch stops ingestion outright and raises no error
    // anywhere; this page is where ingestion health belongs.
    checkIngestStaleness(),
  ])

  const byReason = new Map(reasonCounts.map((r) => [r._id, r.n]))
  const reasonTotal = reasonCounts.reduce((sum, r) => sum + r.n, 0)

  // One entry per address, however many display names it was sent under.
  const senderCounts = new Map<string, { label: string; n: number }>()
  for (const s of senders) {
    const { name, address } = splitSender(s._id)
    if (!address) continue
    const cur = senderCounts.get(address)
    if (cur) cur.n += s.n
    else senderCounts.set(address, { label: name ? `${name} <${address}>` : address, n: s.n })
  }
  const senderOptions = [...senderCounts]
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, 40)
    .map(([value, { label, n }]) => ({ value, label: `${label} (${n})` }))

  const resolverIds = [...new Set(rows.map((r) => r.resolvedById).filter(Boolean).map(String))]
  const resolvers = resolverIds.length
    ? new Map(
        (await User.find({ _id: { $in: resolverIds } }).select('name').lean()).map((u) => [String(u._id), u.name]),
      )
    : new Map<string, string>()

  const view: InboxRowView[] = rows.map((row) => {
    const payload = (row.rawPayload ?? {}) as { body?: string; subject?: string | null; from?: string | null }
    const body = payload.body ?? ''
    const sender = splitSender(payload.from)
    return {
      id: String(row._id),
      reason: row.reason as InboxReason,
      source: row.source,
      sourceLabel: row.source === 'UNKNOWN' ? 'Unknown sender' : sourceLabel(row.source),
      subject: payload.subject?.trim() || null,
      senderName: sender.name || null,
      senderAddress: sender.address || null,
      preview: previewOf(toParseableText(body)),
      detail: row.detail ?? null,
      externalOrderId: row.externalOrderId ?? null,
      gmailMessageId: row.gmailMessageId ?? null,
      partial: summarizePartial(row.partial),
      createdAt: formatIST(row.createdAt),
      createdAtIso: row.createdAt ? new Date(row.createdAt).toISOString() : null,
      resolved: Boolean(row.resolved),
      resolvedAt: row.resolvedAt ? formatIST(row.resolvedAt) : null,
      resolvedBy: row.resolvedById ? (resolvers.get(String(row.resolvedById)) ?? 'A removed user') : null,
      resolution: (row.resolution as InboxRowView['resolution']) ?? (row.resolvedOrderId ? 'ORDER' : null),
      resolvedOrderId: row.resolvedOrderId ? String(row.resolvedOrderId) : null,
      bulkActionCount: row.bulkActionCount ?? null,
    }
  })

  const params = inboxFilterParams(filter)
  const href = (u: URLSearchParams) => {
    const s = u.toString()
    return s ? `/admin/inbox?${s}` : '/admin/inbox'
  }
  const withReason = (reason: InboxReason | null) => {
    const u = new URLSearchParams(params)
    if (reason) u.set('reason', reason)
    else u.delete('reason')
    return href(u)
  }
  const filtered = isFiltered(filter)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Inbox"
        note="Emails that could not become orders. Nothing here was discarded: this is the net that catches an aggregator changing its template."
      />

      <Tabs
        label="Inbox"
        tabs={[
          { href: '/admin/inbox', label: 'Needs attention', count: openCount, active: !filter.resolved },
          { href: '/admin/inbox?show=resolved', label: 'Resolved', active: filter.resolved },
        ]}
      />

      {ingest.stale ? (
        <Notice tone="warn">
          Ingestion needs attention: {ingest.message}. Nothing here will look wrong; the mailbox simply stops arriving.
        </Notice>
      ) : null}

      {!filter.resolved && openCount > 0 && !filtered ? (
        <Notice tone="danger">
          {openCount} email{openCount === 1 ? '' : 's'} did not become an order. Re-ingest the ones that are orders;
          select the rest and dismiss them together.
        </Notice>
      ) : null}

      <InboxFilters
        key={params.toString()}
        filter={filter}
        sources={sources
          .filter((s): s is string => typeof s === 'string')
          .sort()
          .map((s) => ({ value: s, label: s === 'UNKNOWN' ? 'Unknown (no parser)' : sourceLabel(s) }))}
        senders={senderOptions}
        reasons={[
          { href: withReason(null), label: 'All', count: reasonTotal, active: !filter.reason },
          ...INBOX_REASONS.map((r) => ({
            href: withReason(r),
            label: REASON_LABEL[r],
            count: byReason.get(r) ?? 0,
            active: filter.reason === r,
            reason: r,
          })),
        ]}
      />

      {view.length === 0 ? (
        <EmptyState
          title={
            filtered
              ? 'No emails match these filters'
              : filter.resolved
                ? 'Nothing resolved yet'
                : 'Nothing needs attention'
          }
          note={
            filtered
              ? 'Clear a filter to see more.'
              : filter.resolved
                ? 'Rows you correct or dismiss appear here.'
                : 'A rising count here is how a broken parser announces itself.'
          }
        />
      ) : (
        <InboxList
          key={`${params.toString()}|${page}|${pageSize}`}
          rows={view}
          total={total}
          resolved={filter.resolved}
          query={params.toString()}
          pager={
            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              buildHref={(target) => href(withPage(params, target))}
            />
          }
        />
      )}

      <PasteEmailForm />
    </div>
  )
}

/** What the parser did understand, as label/value pairs for the expanded row. */
function summarizePartial(partial: unknown): { label: string; value: string }[] {
  if (!partial || typeof partial !== 'object') return []
  const p = partial as Record<string, unknown>
  const out: { label: string; value: string }[] = []
  const add = (label: string, v: unknown) => {
    if (v === null || v === undefined || v === '') return
    if (typeof v === 'object') return
    out.push({ label, value: String(v) })
  }
  add('Order id', p.externalOrderId)
  add('Outlet', p.outletName)
  add('Station', p.stationCode ?? p.stationName)
  add('Train', [p.trainNo, p.trainName].filter(Boolean).join(' ') || null)
  add('Passenger', p.contactName)
  add('Phone', p.contactPhone)
  add('Seat', [p.coach, p.berth].filter(Boolean).join(' / ') || p.rawSeat || null)
  add('Amount', typeof p.amountPaise === 'number' ? `₹${(p.amountPaise / 100).toFixed(2)}` : null)
  add('Payment', p.paymentMode)
  if (Array.isArray(p.items) && p.items.length) {
    add(
      'Items',
      (p.items as { name?: string; qty?: number }[])
        .slice(0, 6)
        .map((i) => `${i.qty ?? 1} × ${i.name ?? '?'}`)
        .join(', ') + (p.items.length > 6 ? ` +${p.items.length - 6} more` : ''),
    )
  }
  return out
}
