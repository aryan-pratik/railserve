import Link from 'next/link'
import { requireRole } from '@/lib/session'
import { findMany } from '@/lib/repo/orderRepo'
import { formatMoney, formatServiceDate } from '@/lib/format'
import { Card, EmptyState, StatusBadge } from '@/components/ui'

export const metadata = { title: 'Enquiries · RailServe' }

export default async function EnquiriesPage() {
  const ctx = await requireRole('ADMIN')
  const rows = await findMany(ctx, { status: { $in: ['ENQUIRY', 'QUOTED', 'LOST'] } })

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Bulk enquiries</h1>
          <p className="mt-1 text-sm text-slate-600">
            Not yet orders. They reach a kitchen only once quoted and confirmed.
          </p>
        </div>
        <Link href="/admin/enquiries/new"
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          + New enquiry
        </Link>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No open enquiries" note="Paste a WhatsApp message to start one." />
      ) : (
        <div className="space-y-3">
          {rows.map((o) => (
            <Link key={String(o._id)} href={`/admin/enquiries/${String(o._id)}`} className="block">
              <Card className="p-4 transition hover:border-slate-400">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-900">{o.externalOrderId}</span>
                  <StatusBadge status={o.status} />
                  <span className="ml-auto text-sm text-slate-500">
                    {formatServiceDate(o.serviceDate)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  {o.pax ? `${o.pax} pax · ` : ''}{o.stationCode}
                  {o.amountPaise ? ` · ${formatMoney(o.amountPaise)}` : ' · not quoted'}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
