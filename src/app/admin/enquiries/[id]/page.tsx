import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/session'
import { findById } from '@/lib/repo/orderRepo'
import { connectDb } from '@/lib/db'
import { Restaurant, User } from '@/lib/models'
import { formatIST, formatMoney, formatServiceDate, paiseToRupees, utcToIstLocal } from '@/lib/format'
import { Card, CardHeader, StatusBadge, TypeBadge } from '@/components/ui'
import { EventLog } from '@/components/EventLog'
import { ConfirmForm, QuoteForm } from './QuoteForms'
import { markLostAction } from '../actions'

export default async function EnquiryDetail(props: PageProps<'/admin/enquiries/[id]'>) {
  const ctx = await requireRole('ADMIN')
  const { id } = await props.params

  const order = await findById(ctx, id)
  if (!order) notFound()

  await connectDb()
  const actorIds = order.events.map((e) => e.userId).filter((v): v is NonNullable<typeof v> => Boolean(v))
  const [outlets, actors] = await Promise.all([
    Restaurant.find({ active: true }).select('name stationCode').sort({ name: 1 }).lean(),
    User.find({ _id: { $in: actorIds } }).select('name').lean(),
  ])
  const actorName = new Map(actors.map((a) => [String(a._id), a.name]))

  const menu = order.items.find((i) => !i.isPacking)?.spec ?? null
  const packed = order.items.filter((i) => i.isPacking).map((i) => i.name)
  const open = order.status === 'ENQUIRY' || order.status === 'QUOTED'
  const pasted = (order.rawPayload as { pastedText?: string } | null)?.pastedText ?? null

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{order.externalOrderId}</h1>
            <TypeBadge type={order.orderType} />
            <StatusBadge status={order.status} />
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {formatServiceDate(order.serviceDate)} · {order.stationCode}
            {order.pax ? ` · ${order.pax} pax` : ''}
          </p>
        </div>
        <Link href="/admin/enquiries" className="text-sm text-slate-600 underline-offset-2 hover:underline">
          ← All enquiries
        </Link>
      </div>

      {order.status === 'RECEIVED' ? (
        <Card className="border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-medium text-emerald-800">
            Confirmed and live on the outlet dashboard.
          </p>
          <Link href={`/admin/orders/${id}`} className="text-sm text-emerald-800 underline">
            Open the order →
          </Link>
        </Card>
      ) : null}

      {menu ? (
        <Card>
          <CardHeader title="Menu as requested" />
          <pre className="whitespace-pre-wrap px-4 py-3 font-sans text-sm text-slate-700">{menu}</pre>
        </Card>
      ) : null}

      {open ? (
        <>
          <QuoteForm
            orderId={id}
            outlets={outlets.map((o) => ({ id: String(o._id), label: `${o.name} — ${o.stationCode}` }))}
            values={{
              restaurantId: order.restaurantId ? String(order.restaurantId) : '',
              amountRupees: paiseToRupees(order.amountPaise ?? null),
              paymentMode: order.paymentMode ?? '',
              readyBy: utcToIstLocal(order.readyBy),
              contactName: order.contactName ?? '',
              contactPhone: order.contactPhone ?? '',
              handoverPoint: order.handoverPoint ?? '',
            }}
          />

          {order.status === 'QUOTED' ? <ConfirmForm orderId={id} alreadyPacked={packed} /> : null}

          <form action={markLostAction}>
            <input type="hidden" name="orderId" value={id} />
            <button type="submit"
              className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50">
              Mark lost
            </button>
          </form>
        </>
      ) : null}

      <Card>
        <CardHeader title="Quote summary" />
        <div className="divide-y divide-slate-100 text-sm">
          {[
            ['Amount', formatMoney(order.amountPaise ?? null)],
            ['Payment', order.paymentMode ?? '—'],
            ['Ready by', formatIST(order.readyBy)],
            ['Handover', order.handoverPoint ?? '—'],
            ['Contact', order.contactPhone ? `${order.contactName ?? ''} ${order.contactPhone}` : '—'],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 px-4 py-2.5">
              <span className="text-slate-500">{k}</span>
              <span className="text-right font-medium text-slate-900">{v}</span>
            </div>
          ))}
        </div>
      </Card>

      {pasted ? (
        <Card>
          <CardHeader title="Original message" />
          <details className="px-4 py-3">
            <summary className="cursor-pointer text-sm text-slate-600">
              What was actually sent
            </summary>
            <pre className="mt-2 whitespace-pre-wrap rounded bg-slate-50 p-3 font-mono text-xs text-slate-700">
              {pasted}
            </pre>
          </details>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Event log" />
        <EventLog
          events={order.events.map((e) => ({
            fromStatus: e.fromStatus ?? null,
            toStatus: e.toStatus,
            actor: e.userId ? (actorName.get(String(e.userId)) ?? 'Unknown user') : 'System',
            meta: (e.meta ?? {}) as Record<string, unknown>,
            createdAt: e.createdAt,
          }))}
        />
      </Card>
    </div>
  )
}
