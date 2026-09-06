import Link from 'next/link'
import { requireRole } from '@/lib/session'
import { findMany } from '@/lib/repo/orderRepo'
import { formatRupees, formatServiceDate, formatShortDate } from '@/lib/format'
import { ButtonLink, Dash, EmptyState, PageHeader, StatusBadge, thClass } from '@/components/ui'
import { TableFrame } from '@/components/OrdersTable'
import { IconPlus } from '@/components/Icons'

export const metadata = { title: 'Enquiries · RailServe' }

export default async function EnquiriesPage() {
  const ctx = await requireRole('ADMIN')
  const rows = await findMany(ctx, { status: { $in: ['ENQUIRY', 'QUOTED', 'LOST'] } })

  const newButton = (
    <ButtonLink href="/admin/enquiries/new" variant="primary">
      <IconPlus size={15} />
      New enquiry
    </ButtonLink>
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="Bulk enquiries"
        note="Not yet orders. They reach a kitchen only once quoted and confirmed."
        action={newButton}
      />

      {rows.length === 0 ? (
        <EmptyState title="No open enquiries" note="Paste a WhatsApp message to start one." action={newButton} />
      ) : (
        <TableFrame>
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="border-b border-line bg-sunken/60">
              <tr>
                <th className={thClass}>Enquiry</th>
                <th className={thClass}>Date</th>
                <th className={thClass}>Station</th>
                <th className={`${thClass} text-right`}>Pax</th>
                <th className={`${thClass} text-right`}>Amount</th>
                <th className={thClass}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((o) => {
                const lost = o.status === 'LOST'
                return (
                  <tr key={String(o._id)} className={`transition-colors hover:bg-sunken/60 ${lost ? 'bg-sunken/50 text-faint' : ''}`}>
                    <td className="px-3 py-2.5">
                      <Link href={`/admin/enquiries/${String(o._id)}`} className="font-mono text-xs font-semibold text-accent underline-offset-2 hover:underline">
                        {o.externalOrderId}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-muted" title={formatServiceDate(o.serviceDate)}>
                      {formatShortDate(o.serviceDate)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="font-mono text-ink">{o.stationCode}</span>
                      {o.handoverPoint ? (
                        <span className="ml-1.5 inline-block max-w-[16rem] truncate align-bottom text-xs text-faint">{o.handoverPoint}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink">{o.pax ?? <Dash />}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {o.amountPaise ? (
                        <span className="font-medium text-ink">{formatRupees(o.amountPaise)}</span>
                      ) : (
                        <span className="text-faint">Not quoted</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5"><StatusBadge status={o.status} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </TableFrame>
      )}
    </div>
  )
}
