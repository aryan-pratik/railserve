import Link from 'next/link'
import { requireRole } from '@/lib/session'
import { findMany } from '@/lib/repo/orderRepo'
import { formatRupees, formatServiceDate } from '@/lib/format'
import { ButtonLink, Card, EmptyState, PageHeader, StatusBadge } from '@/components/ui'

export const metadata = { title: 'Enquiries · RailServe' }

const TH_BASE = 'px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted'
const TH = `${TH_BASE} text-left`
const TH_NUM = `${TH_BASE} text-right`

export default async function EnquiriesPage() {
  const ctx = await requireRole('ADMIN')
  const rows = await findMany(ctx, { status: { $in: ['ENQUIRY', 'QUOTED', 'LOST'] } })

  return (
    <div className="space-y-5">
      <PageHeader
        title="Bulk enquiries"
        note="Not yet orders. They reach a kitchen only once quoted and confirmed."
        action={
          <ButtonLink href="/admin/enquiries/new" variant="primary">
            + New enquiry
          </ButtonLink>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          title="No open enquiries"
          note="Paste a WhatsApp message to start one."
          action={
            <ButtonLink href="/admin/enquiries/new" variant="primary">
              + New enquiry
            </ButtonLink>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-sunken/60">
                <tr>
                  <th className={TH}>Enquiry</th>
                  <th className={TH}>Date</th>
                  <th className={TH}>Station</th>
                  <th className={TH_NUM}>Pax</th>
                  <th className={TH_NUM}>Amount</th>
                  <th className={TH}>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((o) => {
                  const lost = o.status === 'LOST'
                  return (
                    <tr
                      key={String(o._id)}
                      className={`transition hover:bg-sunken/60 ${lost ? 'bg-sunken/50 text-faint' : ''}`}
                    >
                      <td className="px-3 py-2.5">
                        <Link
                          href={`/admin/enquiries/${String(o._id)}`}
                          className="font-mono font-semibold text-accent underline-offset-2 hover:underline"
                        >
                          {o.externalOrderId}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-muted">
                        {formatServiceDate(o.serviceDate)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="font-mono text-ink">{o.stationCode}</span>
                        {o.handoverPoint ? (
                          <span className="ml-1.5 inline-block max-w-[16rem] truncate align-bottom text-xs text-faint">
                            {o.handoverPoint}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink">
                        {o.pax ?? <span className="text-faint">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {o.amountPaise ? (
                          <span className="font-medium text-ink">{formatRupees(o.amountPaise)}</span>
                        ) : (
                          <span className="text-faint">Not quoted</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusBadge status={o.status} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
