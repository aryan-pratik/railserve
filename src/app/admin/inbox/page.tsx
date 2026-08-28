import Link from 'next/link'
import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { UnparsedInbox } from '@/lib/models'
import { formatIST } from '@/lib/format'
import { Button, Card, EmptyState, PageHeader, Tabs } from '@/components/ui'
import { PasteEmailForm, ResolveForm } from './InboxForms'
import { dismissUnparsed } from './actions'

export const metadata = { title: 'Unparsed inbox · RailServe' }

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

/**
 * The severity edge. A row here is an order nobody is cooking, so the card
 * carries its reason on its left edge — the colour is readable down a stack of
 * ten before a single label has been read.
 */
const REASON_EDGE: Record<string, string> = {
  UNKNOWN_OUTLET: 'border-l-amber-400',
  MISSING_FIELD: 'border-l-orange-400',
  PARSE_FAILED: 'border-l-red-500',
}

export default async function InboxPage(props: PageProps<'/admin/inbox'>) {
  await requireRole('ADMIN')
  const sp = await props.searchParams
  const showResolved = (Array.isArray(sp.show) ? sp.show[0] : sp.show) === 'resolved'

  await connectDb()
  const rows = await UnparsedInbox.find({ resolved: showResolved })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean()
  const openCount = await UnparsedInbox.countDocuments({ resolved: false })

  return (
    <div className="space-y-5">
      <PageHeader
        title="Unparsed inbox"
        note="Emails that could not become orders. Nothing here was discarded — this is the net that catches an aggregator changing its template."
      />

      <Tabs
        tabs={[
          { href: '/admin/inbox', label: 'Needs attention', count: openCount, active: !showResolved },
          { href: '/admin/inbox?show=resolved', label: 'Resolved', active: showResolved },
        ]}
      />

      {!showResolved && openCount > 0 ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800 ring-1 ring-inset ring-red-200">
          {openCount} email{openCount === 1 ? '' : 's'} did not become an order — that is food nobody
          is cooking. Correct or dismiss each one.
        </p>
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
              <Card
                key={String(row._id)}
                className={`border-l-4 ${
                  row.resolved ? 'border-l-emerald-400' : (REASON_EDGE[row.reason] ?? 'border-l-line-strong')
                }`}
              >
                <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
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
                  <p className="text-sm text-muted">{row.detail}</p>

                  <details className="group text-sm">
                    <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted transition hover:text-ink [&::-webkit-details-marker]:hidden">
                      <span className="inline-block transition group-open:rotate-90">›</span>
                      Raw email
                    </summary>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-sunken/60 p-3 font-mono text-xs leading-relaxed text-muted">
                      {body}
                    </pre>
                  </details>

                  {row.resolved ? (
                    <p className="text-sm font-medium text-emerald-700">
                      Resolved {formatIST(row.resolvedAt)}
                      {row.resolvedOrderId ? (
                        <>
                          {' — '}
                          <Link
                            href={`/admin/orders/${String(row.resolvedOrderId)}`}
                            className="text-accent underline underline-offset-2"
                          >
                            view order
                          </Link>
                        </>
                      ) : null}
                    </p>
                  ) : (
                    <div className="flex flex-wrap items-start gap-2">
                      <ResolveForm id={String(row._id)} body={body} />
                      <form action={dismissUnparsed}>
                        <input type="hidden" name="id" value={String(row._id)} />
                        <Button type="submit" variant="secondary" size="sm">
                          Not an order — dismiss
                        </Button>
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
