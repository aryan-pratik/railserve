import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/session'
import { findById, viewCallNotes } from '@/lib/repo/orderRepo'
import { connectDb } from '@/lib/db'
import { Restaurant, User } from '@/lib/models'
import type { OrderStatus } from '@/lib/orderStatus'
import { ROLE_LABEL } from '@/lib/roles'
import { formatIST, formatMoney, formatServiceDate, paiseToRupees, utcToIstLocal } from '@/lib/format'
import { sourceLabel } from '@/lib/orderEnums'
import { Card, CardHeader, Dash, PageHeader, PaymentBadge, StatusBadge, TypeBadge } from '@/components/ui'
import { TrainTiming } from '@/components/TrainTiming'
import { RefreshTrainButton } from '@/components/RefreshTrainButton'
import { timingForOrders, timingFor } from '@/lib/train/service'
import { forceRefreshOrderTrain } from './actions'
import { EventLog } from '@/components/EventLog'
import { CallLog } from '@/components/CallLog'
import { CallNoteForm } from '@/components/CallNoteForm'
import { KotNoteForm } from '@/components/KotNoteForm'
import { DeliveryProof } from '@/components/DeliveryProof'
import {
  AddOrderItem, AssignAgents, DeleteOrderButton, EditOrderItem, OrderDetailsEditor, PaymentModeForm, RemarkForm,
  ReprintKotButton, StatusOverride, TransitionButtons,
} from './AdminOrderActions'
import { ORDER_EDIT_FIELDS } from '@/lib/orderEditFields'
import { adminNextStatusOptions } from '../../statusOptions'
import { viewCancelRequest } from '@/lib/repo/cancelRequestRepo'
import { CancelRequestCard } from '@/components/CancelRequest'

/** Statuses an order can only be in if its KOT has already been sent once. */
const PRINTED_STATUSES = ['KOT_PRINTED', 'PREPARED', 'DISPATCHED', 'DELIVERED', 'FAILED']

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 px-4 py-2.5 text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium text-ink">{value ?? <Dash />}</span>
    </div>
  )
}

export default async function AdminOrderDetail(props: PageProps<'/admin/orders/[id]'>) {
  const ctx = await requireRole('ADMIN')
  const { id } = await props.params

  const order = await findById(ctx, id)
  if (!order) notFound()

  await connectDb()

  // `?? []` because findById is .lean(), which skips the schema's `default: []`
  // — callLog is genuinely undefined on orders written before the field
  // existed, and InferSchemaType types it non-optional, so nothing else catches
  // it. Both logs then resolve their authors from the one existing query.
  const callLog = order.callLog ?? []
  // Rider corrections log the riders by id, before and after; they are named
  // from the same query as the people who acted.
  const riderIdsInLog = order.events.flatMap((e) => {
    const m = (e.meta ?? {}) as Record<string, unknown>
    return [m.agentIds, m.fromAgentIds].flatMap((v) => (Array.isArray(v) ? v.map(String) : []))
  })
  const actorIds = [
    ...order.events.map((e) => e.userId),
    ...callLog.map((n) => n.userId),
    ...riderIdsInLog.filter((id) => /^[0-9a-f]{24}$/i.test(id)),
  ].filter((v): v is NonNullable<typeof v> => Boolean(v))

  const [outlets, agents, actors, timings, cancelRequest] = await Promise.all([
    Restaurant.find().select('name stationCode stationName').sort({ name: 1 }).lean(),
    User.find({ role: 'DELIVERY_AGENT', active: true }).select('name phone').sort({ name: 1 }).lean(),
    User.find({ _id: { $in: actorIds } }).select('name role').lean(),
    timingForOrders([order]),
    viewCancelRequest(order),
  ])
  const outlet = order.restaurantId
    ? (outlets.find((o) => o._id.equals(order.restaurantId!)) ?? null)
    : null

  // What the edit form opens with: every editable field as the string its
  // input takes. Money in rupees and times in IST, as an admin types them.
  const row = order as unknown as Record<string, unknown>
  const editValues = Object.fromEntries(
    ORDER_EDIT_FIELDS.map((f) => {
      const v = row[f.key]
      if (v === null || v === undefined) return [f.key, '']
      if (f.kind === 'money') return [f.key, paiseToRupees(v as number)]
      if (f.kind === 'datetime') return [f.key, utcToIstLocal(v as Date)]
      return [f.key, String(v)]
    }),
  )

  const actorName = new Map(actors.map((a) => [String(a._id), a.name]))
  // Only the call log names the role: both a telecaller and an admin write
  // there, and it matters which.
  const actorLabel = new Map(
    actors.map((a) => [String(a._id), `${a.name} · ${ROLE_LABEL[a.role] ?? a.role}`]),
  )
  const timing = timingFor(order, timings)
  const assigned = order.delivery.agentIds.map(String)
  const riderName = new Map(agents.map((a) => [String(a._id), a.name]))

  // Shared with the board's OrderModal (orderDetail.ts) so the same order
  // shows the same button text and colour wherever it's opened from.
  const options = adminNextStatusOptions(order.status as OrderStatus).map((o) => ({
    to: o.to,
    label: o.label,
    tone: (o.danger ? 'danger' : 'primary') as 'primary' | 'danger',
  }))

  const kitchenItems = order.items.filter((i) => !i.isPacking)
  const packingItems = order.items.filter((i) => i.isPacking)

  return (
    <div className="space-y-5">
      <PageHeader
        back={{ href: '/admin/orders', label: 'All orders' }}
        title={<span className="font-mono">{order.externalOrderId}</span>}
        badges={<><TypeBadge type={order.orderType} /><StatusBadge status={order.status} /></>}
        note={`${sourceLabel(order.source)} → ${outlet ? `${outlet.name} · ${outlet.stationCode}` : 'No outlet'} · ${formatServiceDate(order.serviceDate)}`}
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {cancelRequest ? (
            <CancelRequestCard orderId={String(order._id)} request={cancelRequest} canDecide />
          ) : null}

          <Card>
            <CardHeader title="Journey" />
            <div className="divide-y divide-line">
              <Row label="Train" value={order.trainNo ? `${order.trainNo} ${order.trainName ?? ''}` : 'Not specified'} />
              <Row label="Station" value={order.stationCode} />
              <Row label="Scheduled arrival" value={formatIST(order.scheduledArrival)} />
              <Row
                label="Expected"
                value={
                  <span className="flex flex-wrap items-center justify-end gap-1.5">
                    <TrainTiming timing={timing} />
                    {order.trainNo ? (
                      <RefreshTrainButton orderId={String(order._id)} action={forceRefreshOrderTrain} />
                    ) : null}
                  </span>
                }
              />
              {order.orderType === 'BULK' ? (
                <>
                  <Row label="Pax" value={order.pax} />
                  <Row label="Handover point" value={order.handoverPoint} />
                  <Row label="Ready by" value={formatIST(order.readyBy)} />
                </>
              ) : (
                <Row label="Seat" value={order.rawSeat ? <span className="font-mono">{order.rawSeat}</span> : null} />
              )}
              <Row
                label="Contact"
                value={
                  order.contactPhone ? (
                    <>
                      {order.contactName ?? ''}{' '}
                      <a href={`tel:${order.contactPhone}`} className="font-mono text-accent underline-offset-2 hover:underline">
                        {order.contactPhone}
                      </a>
                    </>
                  ) : (
                    order.contactName ?? null
                  )
                }
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Order details" />
            <OrderDetailsEditor
              orderId={String(order._id)}
              values={editValues}
              outlets={outlets.map((o) => ({ id: String(o._id), label: `${o.name} · ${o.stationCode}` }))}
            />
          </Card>

          <Card>
            <CardHeader title="Items" />
            <ul className="divide-y divide-line">
              {kitchenItems.map((i) => (
                <li key={String(i._id)} className="px-4 py-3 text-sm">
                  <div className="flex justify-between gap-4">
                    <span className="font-medium text-ink">{i.name}</span>
                    <span className="flex shrink-0 items-center gap-2 tabular-nums text-muted">
                      ×{i.qty}
                      {i.pricePaise !== null ? ` · ${formatMoney(i.pricePaise)}` : ''}
                      <EditOrderItem
                        orderId={String(order._id)}
                        itemId={String(i._id)}
                        name={i.name}
                        qty={i.qty}
                        pricePaise={i.pricePaise}
                        notes={i.notes}
                        spec={i.spec}
                        isPacking={i.isPacking}
                      />
                    </span>
                  </div>
                  {i.spec ? (
                    <pre className="mt-2 whitespace-pre-wrap rounded bg-sunken p-3 font-sans text-xs text-muted">{i.spec}</pre>
                  ) : null}
                  {i.notes ? (
                    <p className="mt-2 whitespace-pre-wrap text-xs italic text-muted">{i.notes}</p>
                  ) : null}
                </li>
              ))}
              {packingItems.length > 0 ? (
                <li className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-muted">Packing</li>
              ) : null}
              {packingItems.map((i) => (
                <li key={String(i._id)} className="px-4 py-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-x-4">
                    <span className="text-muted">{i.name}</span>
                    <span className="flex shrink-0 items-center gap-2 tabular-nums text-muted">
                      ×{i.qty}
                      {i.pricePaise != null ? ` · ${formatMoney(i.pricePaise)}` : ''}
                      <EditOrderItem
                        orderId={String(order._id)}
                        itemId={String(i._id)}
                        name={i.name}
                        qty={i.qty}
                        pricePaise={i.pricePaise}
                        notes={i.notes}
                        spec={i.spec}
                        isPacking={i.isPacking}
                      />
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <div className="border-t border-line">
              <AddOrderItem orderId={String(order._id)} />
            </div>
            <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm">
              <PaymentBadge mode={order.paymentMode} />
              <span className="font-semibold tabular-nums">{formatMoney(order.amountPaise)}</span>
            </div>
          </Card>

          {order.notes ? (
            <Card>
              <CardHeader title="Notes" />
              <p className="whitespace-pre-wrap px-4 py-3 text-sm text-muted">{order.notes}</p>
            </Card>
          ) : null}

          {/* Left column, not right: the right-hand track is narrow controls,
              and a list that grows would shove Danger zone an unpredictable
              distance down it. Unconditional: the box must be here when the
              log is empty. */}
          <Card>
            <CardHeader title="Call log" />
            <CallLog orderId={String(order._id)} notes={viewCallNotes(ctx, callLog, actorLabel)} />
            <div className="border-t border-line">
              <CallNoteForm orderId={String(order._id)} />
            </div>
          </Card>

          <Card>
            <CardHeader title="Event log" />
            <EventLog
              names={actorName}
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
            <CardHeader title="Actions" />
            <TransitionButtons orderId={String(order._id)} options={options} />
            {/* Only once the order is past the printing step: before it, the
                transition button itself is what prints. */}
            {order.restaurantId && PRINTED_STATUSES.includes(order.status) ? (
              <ReprintKotButton orderId={String(order._id)} />
            ) : null}
            <StatusOverride orderId={String(order._id)} status={order.status} />
          </Card>

          <Card>
            <CardHeader title="Payment mode" />
            <PaymentModeForm orderId={String(order._id)} paymentMode={order.paymentMode ?? null} />
          </Card>

          <Card>
            <CardHeader title="Remark for the kitchen" />
            <RemarkForm orderId={String(order._id)} remark={order.remark ?? null} />
          </Card>

          {/* Distinct from the remark above: this one prints on the KOT. */}
          <Card>
            <CardHeader title="KOT note" />
            <KotNoteForm orderId={String(order._id)} kotNote={order.kotNote ?? null} />
          </Card>

          <DeliveryProof
            delivery={order.delivery}
            riders={assigned.map((id) => riderName.get(id) ?? 'Unknown rider')}
          />

          <Card>
            <CardHeader title="Correct the rider" />
            <AssignAgents
              orderId={String(order._id)}
              assigned={assigned}
              agents={agents.map((a) => ({ id: String(a._id), name: a.name, phone: a.phone }))}
            />
          </Card>

          <Card>
            <CardHeader title="Provenance" />
            <div className="divide-y divide-line">
              <Row label="Source" value={order.source} />
              <Row label="Created" value={formatIST(order.createdAt)} />
              <Row label="Updated" value={formatIST(order.updatedAt)} />
            </div>
          </Card>

          <Card>
            <CardHeader title="Danger zone" />
            <DeleteOrderButton orderId={String(order._id)} externalOrderId={order.externalOrderId} />
          </Card>
        </div>
      </div>
    </div>
  )
}
