import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/session'
import { isProofStorageConfigured } from '@/lib/storage'
import { findById } from '@/lib/repo/orderRepo'
import { formatIST, formatMoney, paiseToRupees } from '@/lib/format'
import { runKeyFor } from '@/lib/runs'
import { BackLink, Card, CardHeader, Dash, StatusBadge, TypeBadge } from '@/components/ui'
import { IconPhone } from '@/components/Icons'
import { DeliverForm, FailForm, TakeOrderButton } from '../../AgentActions'

export const metadata = { title: 'Deliver · RailServe' }

export default async function AgentOrderPage(props: PageProps<'/agent/orders/[id]'>) {
  const ctx = await requireRole('DELIVERY_AGENT')
  const { id } = await props.params

  // Scoped: an agent only ever resolves an order from their own outlets.
  const order = await findById(ctx, id)
  if (!order) notFound()

  const photoEnabled = isProofStorageConfigured()

  const cod = order.paymentMode === 'COD'
  const kitchen = order.items.filter((i) => !i.isPacking)
  const packing = order.items.filter((i) => i.isPacking)
  const runKey = runKeyFor(order)

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <BackLink href={`/agent/runs/${encodeURIComponent(runKey)}`}>Back to run</BackLink>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-lg font-bold text-ink">{order.externalOrderId}</span>
          <TypeBadge type={order.orderType} />
          <StatusBadge status={order.status} />
        </div>

        <div className="mt-3 flex items-start gap-3">
          <div className="rounded-lg bg-ink px-3 py-2 font-mono text-2xl font-bold leading-none tabular-nums text-white">
            {order.coach ?? '?'}
          </div>
          <div className="text-sm">
            {order.orderType === 'BULK' ? (
              <>
                <div className="font-semibold text-ink">{order.pax} pax</div>
                <div className="text-muted">{order.handoverPoint}</div>
              </>
            ) : (
              <>
                <div className="font-semibold text-ink">Berth {order.berth ?? <Dash />}</div>
                <div className="text-muted"><span className="font-mono">{order.trainNo}</span> {order.trainName}</div>
              </>
            )}
          </div>
        </div>

        {order.remark ? (
          <div className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 ring-1 ring-inset ring-amber-200">
            <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">Remark</div>
            <div className="mt-1 whitespace-pre-wrap">{order.remark}</div>
          </div>
        ) : null}

        {/* Tap to call: the agent is on a platform holding a phone. */}
        {order.contactPhone ? (
          <a
            href={`tel:${order.contactPhone}`}
            className="mt-3 flex items-center justify-between rounded-xl border border-line-strong px-4 py-3 transition-colors hover:bg-sunken"
          >
            <span>
              <span className="block text-sm font-medium text-ink">{order.contactName ?? 'Passenger'}</span>
              <span className="font-mono text-sm tabular-nums text-muted">{order.contactPhone}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
              <IconPhone size={15} aria-hidden />
              Call
            </span>
          </a>
        ) : null}

        <div className={`mt-3 rounded-xl px-4 py-3 text-center ${cod ? 'bg-amber-100 text-amber-900' : 'bg-sunken text-muted'}`}>
          <div className="text-xs font-semibold uppercase tracking-wide">
            {cod ? 'Collect on delivery' : (order.paymentMode ?? 'Payment')}
          </div>
          <div className="text-2xl font-bold tabular-nums">{cod ? formatMoney(order.amountPaise) : 'Already paid'}</div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Items" />
        <ul className="divide-y divide-line">
          {kitchen.map((i) => (
            <li key={String(i._id)} className="px-4 py-2.5 text-sm">
              <span className="font-semibold tabular-nums">{i.qty}×</span> {i.name}
            </li>
          ))}
          {packing.length > 0 ? (
            <li className="px-4 py-2.5">
              <div className="flex flex-wrap gap-1.5">
                {packing.map((i) => (
                  <span key={String(i._id)} className="rounded-full bg-sunken px-2 py-0.5 text-xs text-muted">
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
            photoEnabled={photoEnabled}
          />
          <FailForm orderId={id} />
        </Card>
      ) : order.status === 'DELIVERED' ? (
        <Card className="p-4">
          <div className="text-sm font-semibold text-emerald-700">Delivered</div>
          <div className="mt-1 text-sm text-muted">
            Received by {order.delivery.proofValue ?? 'unrecorded'} at {formatIST(order.delivery.deliveredAt)}
          </div>
          {order.delivery.amountCollectedPaise !== null ? (
            <div className="mt-1 text-sm text-muted">Collected {formatMoney(order.delivery.amountCollectedPaise)}</div>
          ) : null}
        </Card>
      ) : order.status === 'FAILED' ? (
        <Card className="p-4">
          <div className="text-sm font-semibold text-red-700">Not delivered</div>
          <div className="mt-1 text-sm text-muted">{order.delivery.failureReason ?? 'No reason recorded.'}</div>
        </Card>
      ) : order.status === 'PREPARED' ? (
        <Card>
          <CardHeader title="Ready on the shelf" />
          <TakeOrderButton orderId={id} />
        </Card>
      ) : (
        <Card className="p-4 text-sm text-muted">
          Still in the kitchen. This opens as soon as the food is ready.
        </Card>
      )}
    </div>
  )
}
