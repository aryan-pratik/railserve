import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/session'
import { findById } from '@/lib/repo/orderRepo'
import { connectDb } from '@/lib/db'
import { Restaurant, User } from '@/lib/models'
import { allowedNextStatuses, type OrderStatus } from '@/lib/orderStatus'
import { formatIST, formatMoney, formatServiceDate } from '@/lib/format'
import { Card, CardHeader, StatusBadge, TypeBadge } from '@/components/ui'
import { EventLog } from '@/components/EventLog'
import { AssignAgents, TransitionButtons } from './AdminOrderActions'

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 px-4 py-2.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-900">{value}</span>
    </div>
  )
}

export default async function AdminOrderDetail(props: PageProps<'/admin/orders/[id]'>) {
  const ctx = await requireRole('ADMIN')
  const { id } = await props.params

  const order = await findById(ctx, id)
  if (!order) notFound()

  await connectDb()

  const actorIds = order.events
    .map((e) => e.userId)
    .filter((v): v is NonNullable<typeof v> => Boolean(v))

  const [outlet, agents, actors] = await Promise.all([
    order.restaurantId
      ? Restaurant.findById(order.restaurantId).select('name stationCode stationName').lean()
      : null,
    User.find({ role: 'DELIVERY_AGENT', active: true }).select('name phone').sort({ name: 1 }).lean(),
    User.find({ _id: { $in: actorIds } })
      .select('name role')
      .lean(),
  ])

  const actorName = new Map(actors.map((a) => [String(a._id), a.name]))
  const assigned = order.delivery.agentIds.map(String)

  const nextStatuses = allowedNextStatuses(order.status as OrderStatus, 'ADMIN')
  const options = nextStatuses.map((to) => ({
    to,
    label:
      to === 'CANCELLED' ? 'Cancel order'
      : to === 'LOST' ? 'Mark lost'
      : `Mark ${to.replace('_', ' ').toLowerCase()}`,
    tone: (to === 'CANCELLED' || to === 'LOST' ? 'danger' : 'primary') as 'primary' | 'danger',
  }))

  const kitchenItems = order.items.filter((i) => !i.isPacking)
  const packingItems = order.items.filter((i) => i.isPacking)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{order.externalOrderId}</h1>
            <TypeBadge type={order.orderType} />
            <StatusBadge status={order.status} />
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {outlet ? `${outlet.name} · ${outlet.stationCode}` : 'No outlet'} ·{' '}
            {formatServiceDate(order.serviceDate)}
          </p>
        </div>
        <Link href="/admin/orders" className="text-sm text-slate-600 underline-offset-2 hover:underline">
          ← All orders
        </Link>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader title="Journey" />
            <div className="divide-y divide-slate-100">
              <Row label="Train" value={order.trainNo ? `${order.trainNo} ${order.trainName ?? ''}` : 'Not specified'} />
              <Row label="Station" value={order.stationCode} />
              <Row
                label="Scheduled arrival"
                value={
                  <>
                    {formatIST(order.scheduledArrival)}
                    <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                      {order.timingSource}
                    </span>
                  </>
                }
              />
              {order.orderType === 'BULK' ? (
                <>
                  <Row label="Pax" value={order.pax ?? '—'} />
                  <Row label="Handover point" value={order.handoverPoint ?? '—'} />
                  <Row label="Ready by" value={formatIST(order.readyBy)} />
                </>
              ) : (
                <Row label="Seat" value={order.rawSeat ?? '—'} />
              )}
              <Row
                label="Contact"
                value={
                  order.contactPhone ? (
                    <>
                      {order.contactName ?? '—'}{' '}
                      <a href={`tel:${order.contactPhone}`} className="text-slate-600 underline">
                        {order.contactPhone}
                      </a>
                    </>
                  ) : (
                    '—'
                  )
                }
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Items" />
            <ul className="divide-y divide-slate-100">
              {kitchenItems.map((i) => (
                <li key={String(i._id)} className="px-4 py-3 text-sm">
                  <div className="flex justify-between gap-4">
                    <span className="font-medium text-slate-900">{i.name}</span>
                    <span className="shrink-0 text-slate-600">
                      × {i.qty}
                      {i.pricePaise !== null ? ` · ${formatMoney(i.pricePaise)}` : ''}
                    </span>
                  </div>
                  {i.spec ? (
                    <pre className="mt-2 whitespace-pre-wrap rounded bg-slate-50 p-3 font-sans text-xs text-slate-700">
                      {i.spec}
                    </pre>
                  ) : null}
                </li>
              ))}
              {packingItems.length > 0 ? (
                <li className="px-4 py-3">
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Packing
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {packingItems.map((i) => (
                      <span key={String(i._id)}
                        className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                        {i.name} × {i.qty}
                      </span>
                    ))}
                  </div>
                </li>
              ) : null}
            </ul>
            <div className="flex justify-between border-t border-slate-200 px-4 py-3 text-sm">
              <span className="text-slate-500">{order.paymentMode ?? 'No payment mode'}</span>
              <span className="font-semibold">{formatMoney(order.amountPaise)}</span>
            </div>
          </Card>

          {order.notes ? (
            <Card>
              <CardHeader title="Notes" />
              <p className="whitespace-pre-wrap px-4 py-3 text-sm text-slate-700">{order.notes}</p>
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

        <div className="space-y-5">
          <Card>
            <CardHeader title="Admin actions" />
            <TransitionButtons orderId={String(order._id)} options={options} />
          </Card>

          <Card>
            <CardHeader title="Delivery agents" />
            <AssignAgents
              orderId={String(order._id)}
              assigned={assigned}
              agents={agents.map((a) => ({ id: String(a._id), name: a.name, phone: a.phone }))}
            />
          </Card>

          <Card>
            <CardHeader title="Provenance" />
            <div className="divide-y divide-slate-100">
              <Row label="Source" value={order.source} />
              <Row label="Created" value={formatIST(order.createdAt)} />
              <Row label="Updated" value={formatIST(order.updatedAt)} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
