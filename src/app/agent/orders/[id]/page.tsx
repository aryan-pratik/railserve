import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/session'
import { findById } from '@/lib/repo/orderRepo'
import { formatIST, formatMoney, paiseToRupees } from '@/lib/format'
import { runKeyFor } from '@/lib/runs'
import { Card, CardHeader, StatusBadge, TypeBadge } from '@/components/ui'
import { DeliverForm, FailForm } from '../../AgentActions'

export const metadata = { title: 'Deliver · RailServe' }

export default async function AgentOrderPage(props: PageProps<'/agent/orders/[id]'>) {
  const ctx = await requireRole('DELIVERY_AGENT')
  const { id } = await props.params

  // Scoped: an agent only ever resolves an order assigned to them.
  const order = await findById(ctx, id)
  if (!order) notFound()

  const cod = order.paymentMode === 'COD'
  const kitchen = order.items.filter((i) => !i.isPacking)
  const packing = order.items.filter((i) => i.isPacking)
  const runKey = runKeyFor(order)

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link
        href={`/agent/runs/${encodeURIComponent(runKey)}`}
        className="text-sm text-slate-600 underline-offset-2 hover:underline"
      >
        ← Back to run
      </Link>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-lg font-bold text-slate-900">{order.externalOrderId}</span>
          <TypeBadge type={order.orderType} />
          <StatusBadge status={order.status} />
        </div>

        <div className="mt-3 flex items-start gap-3">
          <div className="rounded-lg bg-slate-900 px-3 py-2 text-2xl font-bold leading-none text-white">
            {order.coach ?? '—'}
          </div>
          <div className="text-sm">
            {order.orderType === 'BULK' ? (
              <>
                <div className="font-semibold text-slate-900">{order.pax} pax</div>
                <div className="text-slate-600">{order.handoverPoint}</div>
              </>
            ) : (
              <>
                <div className="font-semibold text-slate-900">
                  Berth {order.berth ?? '—'}
                </div>
                <div className="text-slate-600">{order.trainNo} {order.trainName}</div>
              </>
            )}
          </div>
        </div>

        {/* Tap to call: the agent is on a platform holding a phone. */}
        {order.contactPhone ? (
          <a
            href={`tel:${order.contactPhone}`}
            className="mt-3 flex items-center justify-between rounded-xl border border-slate-300 px-4 py-3 transition hover:bg-slate-50"
          >
            <span>
              <span className="block text-sm font-medium text-slate-900">
                {order.contactName ?? 'Passenger'}
              </span>
              <span className="text-sm text-slate-600">{order.contactPhone}</span>
            </span>
            <span className="text-sm font-semibold text-slate-900">Call</span>
          </a>
        ) : null}

        <div
          className={`mt-3 rounded-xl px-4 py-3 text-center ${
            cod ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700'
          }`}
        >
          <div className="text-xs font-semibold uppercase tracking-wide">
            {cod ? 'Collect on delivery' : (order.paymentMode ?? 'Payment')}
          </div>
          <div className="text-2xl font-bold">
            {cod ? formatMoney(order.amountPaise) : 'Already paid'}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Items" />
        <ul className="divide-y divide-slate-100">
          {kitchen.map((i) => (
            <li key={String(i._id)} className="px-4 py-2.5 text-sm">
              <span className="font-semibold tabular-nums">{i.qty}×</span> {i.name}
            </li>
          ))}
          {packing.length > 0 ? (
            <li className="px-4 py-2.5">
              <div className="flex flex-wrap gap-1.5">
                {packing.map((i) => (
                  <span key={String(i._id)}
                    className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    {i.name} ×{i.qty}
                  </span>
                ))}
              </div>
            </li>
          ) : null}
        </ul>
      </Card>

      {order.status === 'DISPATCHED' ? (
        <Card>
          <CardHeader title="Complete delivery" />
          <DeliverForm
            orderId={id}
            isCod={cod}
            amountRupees={paiseToRupees(order.amountPaise)}
          />
          <FailForm orderId={id} />
        </Card>
      ) : order.status === 'DELIVERED' ? (
        <Card className="p-4">
          <div className="text-sm font-semibold text-emerald-700">Delivered</div>
          <div className="mt-1 text-sm text-slate-600">
            Received by {order.delivery.proofValue ?? '—'} at {formatIST(order.delivery.deliveredAt)}
          </div>
          {order.delivery.amountCollectedPaise !== null ? (
            <div className="mt-1 text-sm text-slate-600">
              Collected {formatMoney(order.delivery.amountCollectedPaise)}
            </div>
          ) : null}
        </Card>
      ) : order.status === 'FAILED' ? (
        <Card className="p-4">
          <div className="text-sm font-semibold text-red-700">Not delivered</div>
          <div className="mt-1 text-sm text-slate-600">{order.delivery.failureReason ?? '—'}</div>
        </Card>
      ) : (
        <Card className="p-4 text-sm text-slate-600">
          Waiting on the kitchen and dispatch. Delivery opens once the run is dispatched.
        </Card>
      )}
    </div>
  )
}
