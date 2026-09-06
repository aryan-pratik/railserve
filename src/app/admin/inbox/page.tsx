import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { UnparsedInbox } from '@/lib/models'
import { formatIST } from '@/lib/format'
import { checkIngestStaleness } from '@/lib/ingest/gmail/sync'
import { Button, ButtonLink, Card, EmptyState, Notice, PageHeader, Tabs } from '@/components/ui'
import { IconChevronRight } from '@/components/Icons'
import { PasteEmailForm, ResolveForm } from './InboxForms'
import { dismissUnparsed } from './actions'

export const metadata = { title: 'Inbox · RailServe' }

const REASON_LABEL: Record<string, string> = {
  UNKNOWN_OUTLET: 'Outlet not recognised',
  MISSING_FIELD: 'Required field missing',
  PARSE_FAILED: 'Could not parse',
}

const REASON_STYLE: Record<string, string> = {
  UNKNOWN_OUTLET: 'bg-amber-100 text-amber-900 ring-amber-200',
  MISSING_FIELD: 'bg-orange-100 text-orange-900 ring-orange-200',
  PARSE_FAILED: 'bg-red-100 text-red-800 ring-red-200',
}

/** The severity tint: a wash across the card header, readable down a stack of ten. */
const REASON_TINT: Record<string, string> = {
  UNKNOWN_OUTLET: 'bg-amber-50/70',
  MISSING_FIELD: 'bg-orange-50/70',
  PARSE_FAILED: 'bg-red-50/70',
}

export default async function InboxPage(props: PageProps<'/admin/inbox'>) {
  await requireRole('ADMIN')
  const sp = await props.searchParams
  const showResolved = (Array.isArray(sp.show) ? sp.show[0] : sp.show) === 'resolved'

  await connectDb()
  const [rows, openCount, ingest] = await Promise.all([
    UnparsedInbox.find({ resolved: showResolved }).sort({ createdAt: -1 }).limit(100).lean(),
    UnparsedInbox.countDocuments({ resolved: false }),
    // A lapsed Gmail watch stops ingestion outright and raises no error
    // anywhere; this page is where ingestion health belongs.
    checkIngestStaleness(),
  ])

  return (
    <div className="space-y-4">
      <PageHeader
        title="Inbox"
        note="Emails that could not become orders. Nothing here was discarded. This is the net that catches an aggregator changing its template."
      />

      <Tabs
        label="Inbox"
        tabs={[
          { href: '/admin/inbox', label: 'Needs attention', count: openCount, active: !showResolved },
          { href: '/admin/inbox?show=resolved', label: 'Resolved', active: showResolved },
        ]}
      />

      {ingest.stale ? (
        <Notice tone="warn">
          Ingestion needs attention: {ingest.message}. Nothing here will look wrong; the mailbox simply stops arriving.
        </Notice>
      ) : null}

      {!showResolved && openCount > 0 ? (
        <Notice tone="danger">
          {openCount} email{openCount === 1 ? '' : 's'} did not become an order. That is food nobody is cooking. Correct or dismiss each one.
        </Notice>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title={showResolved ? 'Nothing resolved yet' : 'Nothing needs attention'}
          note={
            showResolved
              ? 'Rows you correct or dismiss appear here.'
              : 'A rising count here is how a broken parser announces itself.'
          }
        />
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const body = (row.rawPayload as { body?: string })?.body ?? ''
            return (
              <Card key={String(row._id)}>
                <div
                  className={`flex flex-wrap items-center gap-2 rounded-t-xl border-b border-line px-4 py-2.5 ${
                    row.resolved ? 'bg-emerald-50/70' : (REASON_TINT[row.reason] ?? 'bg-sunken/50')
                  }`}
                >
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${
                      REASON_STYLE[row.reason] ?? 'bg-sunken text-muted ring-line-strong'
                    }`}
                  >
                    {REASON_LABEL[row.reason] ?? row.reason}
                  </span>
                  <span className="text-sm font-medium text-ink">{row.source}</span>
                  {row.externalOrderId ? (
                    <span className="font-mono text-sm tabular-nums text-muted">#{row.externalOrderId}</span>
                  ) : null}
                  <span className="ml-auto text-xs tabular-nums text-faint">{formatIST(row.createdAt)}</span>
                </div>

                <div className="space-y-3 px-4 py-3">
                  <p className="text-sm text-muted text-pretty">{row.detail}</p>

                  <details className="group text-sm">
                    <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
                      <IconChevronRight size={14} aria-hidden className="transition-transform group-open:rotate-90" />
                      Raw email
                    </summary>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-sunken/60 p-3 font-mono text-xs leading-relaxed text-muted">{body}</pre>
                  </details>

                  {row.resolved ? (
                    <div className="flex flex-wrap items-center gap-3 text-sm font-medium text-emerald-700">
                      Resolved {formatIST(row.resolvedAt)}
                      {row.resolvedOrderId ? (
                        <ButtonLink href={`/admin/orders/${String(row.resolvedOrderId)}`} size="sm">View order</ButtonLink>
                      ) : null}
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-start gap-2">
                      <ResolveForm id={String(row._id)} body={body} />
                      <form action={dismissUnparsed}>
                        <input type="hidden" name="id" value={String(row._id)} />
                        <Button type="submit" variant="secondary" size="sm">Dismiss as not an order</Button>
                      </form>
                    </div>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <PasteEmailForm />
    </div>
  )
}
