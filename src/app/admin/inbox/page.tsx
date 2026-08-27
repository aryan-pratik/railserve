import Link from 'next/link'
import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { UnparsedInbox } from '@/lib/models'
import { formatIST } from '@/lib/format'
import { Card, EmptyState } from '@/components/ui'
import { PasteEmailForm, ResolveForm } from './InboxForms'
import { dismissUnparsed } from './actions'

export const metadata = { title: 'Unparsed inbox · RailServe' }

const REASON_LABEL: Record<string, string> = {
  UNKNOWN_OUTLET: 'Outlet not recognised',
  MISSING_FIELD: 'Required field missing',
  PARSE_FAILED: 'Could not parse',
}

const REASON_STYLE: Record<string, string> = {
  UNKNOWN_OUTLET: 'bg-amber-100 text-amber-800 ring-amber-200',
  MISSING_FIELD: 'bg-orange-100 text-orange-800 ring-orange-200',
  PARSE_FAILED: 'bg-red-100 text-red-800 ring-red-200',
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
      <div>
        <h1 className="text-xl font-semibold">Unparsed inbox</h1>
        <p className="mt-1 text-sm text-slate-600">
          Emails that could not become orders. Nothing here was discarded — this is
          the net that catches an aggregator changing its template.
        </p>
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        <Link href="/admin/inbox"
          className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
            !showResolved ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}>
          Needs attention
          <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs tabular-nums">
            {openCount}
          </span>
        </Link>
        <Link href="/admin/inbox?show=resolved"
          className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
            showResolved ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}>
          Resolved
        </Link>
      </div>

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
        <div className="space-y-4">
          {rows.map((row) => {
            const body = (row.rawPayload as { body?: string })?.body ?? ''
            return (
              <Card key={String(row._id)}>
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${
                    REASON_STYLE[row.reason] ?? 'bg-slate-100 text-slate-700 ring-slate-200'
                  }`}>
                    {REASON_LABEL[row.reason] ?? row.reason}
                  </span>
                  <span className="text-sm font-medium text-slate-900">{row.source}</span>
                  {row.externalOrderId ? (
                    <span className="text-sm text-slate-500">#{row.externalOrderId}</span>
                  ) : null}
                  <span className="ml-auto text-xs text-slate-400">{formatIST(row.createdAt)}</span>
                </div>

                <div className="space-y-3 p-4">
                  <p className="text-sm text-slate-700">{row.detail}</p>

                  <details className="text-sm">
                    <summary className="cursor-pointer text-slate-600 hover:text-slate-900">
                      Raw email
                    </summary>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-3 font-mono text-xs text-slate-700">
                      {body}
                    </pre>
                  </details>

                  {row.resolved ? (
                    <p className="text-sm font-medium text-emerald-700">
                      Resolved {formatIST(row.resolvedAt)}
                      {row.resolvedOrderId ? (
                        <>
                          {' — '}
                          <Link href={`/admin/orders/${String(row.resolvedOrderId)}`} className="underline">
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
                        <button type="submit"
                          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
                          Not an order — dismiss
                        </button>
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
