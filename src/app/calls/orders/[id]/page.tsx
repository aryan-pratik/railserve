import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/session'
import { findById, viewCallNotes } from '@/lib/repo/orderRepo'
import { connectDb } from '@/lib/db'
import { User } from '@/lib/models'
import { toCardData } from '@/lib/orderView'
import { dietLookupFor } from '@/lib/repo/menuRepo'
import { timingFor, timingForOrders } from '@/lib/train/service'
import { TrainTiming } from '@/components/TrainTiming'
import { allowedNextStatuses, canFlagRatingOrder, isTerminal, type OrderStatus } from '@/lib/orderStatus'
import { ROLE_LABEL } from '@/lib/roles'
import { BackLink, Card, CardHeader, Notice } from '@/components/ui'
import { OrderCard } from '@/components/OrderCard'
import { EventLog } from '@/components/EventLog'
import { CallLog } from '@/components/CallLog'
import { CallNoteForm } from '@/components/CallNoteForm'
import { KotNoteForm } from '@/components/KotNoteForm'
import { IconPhone } from '@/components/Icons'
import { OpenChatButton } from '@/components/chat/OpenChatButton'
import { normalisePhone } from '@/lib/whatsapp/phone'
import { CancelOrderButton } from '../../CancelOrderButton'
import { OutcomeActionButton } from '../../OutcomeActionButton'
import { RatingOrderButton } from '../../RatingOrderButton'
import { DeliveredButton } from '../../DeliveredButton'
import { markNotDelivered, markRefunded } from '../../actions'
import { viewCancelRequest } from '@/lib/repo/cancelRequestRepo'
import { CancelRequestCard } from '@/components/CancelRequest'
import { viewReturn } from '@/lib/repo/rtoRepo'
import { ReturnToOriginCard } from '@/components/ReturnToOrigin'
import { AssignRidersCard } from '@/components/AssignRiders'
import { listAssignableRiders } from '@/lib/repo/transitionOrder'

/**
 * One order, as the person on the phone needs it: what was ordered, which
 * seat it is going to, the number to ring, and the single button that records
 * what the passenger said.
 *
 * Money is off (`showMoney={false}`) — see the note on OrderCard.
 */
export default async function CallOrderDetail(props: PageProps<'/calls/orders/[id]'>) {
  const ctx = await requireRole('TELECALLER')
  const { id } = await props.params

  // Scoped read: an order from an outlet this telecaller does not hold is a
  // miss here, not a permission error.
  const order = await findById(ctx, id)
  if (!order) notFound()

  await connectDb()
  // Live arrival, cache-only, for the same reasons as the call list.
  const [timings, cancelRequest, riders, rto] = await Promise.all([
    timingForOrders([order], { allowFetch: false }),
    viewCancelRequest(order),
    listAssignableRiders(ctx, order.restaurantId),
    viewReturn(order),
  ])
  // Both logs draw their authors from one query — $in dedupes server-side, so
  // widening the id list costs no extra round trip.
  //
  // `?? []` is not defensive padding: findById is .lean(), which skips the
  // document constructor and therefore skips the schema's `default: []`, so
  // callLog really is undefined on every order written before it existed.
  // InferSchemaType types it non-optional, so nothing else would catch this.
  const callLog = order.callLog ?? []
  const actorIds = [...order.events.map((e) => e.userId), ...callLog.map((n) => n.userId)].filter(
    (v): v is NonNullable<typeof v> => Boolean(v),
  )
  const actors = await User.find({ _id: { $in: actorIds }, tenantId: ctx.tenantId }).select('name role').lean()
  const actorName = new Map(actors.map((a) => [String(a._id), a.name]))
  // Only the call log carries the role: both a telecaller and an admin write
  // there, and a manager reading a note cares which. The event log's actors
  // are already unambiguous from the transition itself.
  const actorLabel = new Map(
    actors.map((a) => [String(a._id), `${a.name} · ${ROLE_LABEL[a.role] ?? a.role}`]),
  )

  // The allow-list decides, not this page. If TRANSITIONS ever changes, the
  // buttons follow it rather than drifting from it.
  const nextStatuses = allowedNextStatuses(order.status as OrderStatus, 'TELECALLER')
  const canCancel = nextStatuses.includes('CANCELLED')
  const canDeliver = nextStatuses.includes('DELIVERED')
  const canFail = nextStatuses.includes('FAILED')
  // Refunds and the rating-order tag are not statuses: they sit on the order
  // whatever its status, so they are offered on any order not yet carrying one.
  const canRefund = !order.refund
  const canFlagRating = canFlagRatingOrder('TELECALLER') && !order.ratingOrder
  const noOutcomeAvailable = !canCancel && !canDeliver && !canFail && !canRefund && !canFlagRating

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <BackLink href="/calls">Back to the call list</BackLink>

      <OrderCard
        order={toCardData(order, await dietLookupFor(ctx.tenantId, [order]))}
        href={`/calls/orders/${id}`}
        showServiceDate
        showMoney={false}
        timing={<TrainTiming timing={timingFor(order, timings)} />}
        actions={
          <div className="space-y-2">
            {canDeliver || canFail ? (
              <div className="flex flex-wrap items-center gap-2">
                {canDeliver ? <DeliveredButton orderId={id} /> : null}
                {canFail ? (
                  <OutcomeActionButton
                    orderId={id}
                    action={markNotDelivered}
                    buttonLabel="Not delivered"
                    modalTitle="Mark as not delivered?"
                    description="The food did not reach the passenger. This closes the order as not delivered, with your reason, for the outlet and admin."
                    quickReasons={[
                      'Passenger not reachable at the seat',
                      'Train left before the food reached it',
                      'Given to the wrong passenger',
                      'Passenger refused the food',
                    ]}
                  />
                ) : null}
              </div>
            ) : null}
            {canCancel || canRefund ? (
              <div className="flex flex-wrap items-center gap-2">
                {canCancel ? (
                  <CancelOrderButton orderId={id} externalOrderId={order.externalOrderId} />
                ) : null}
                {canRefund ? (
                  <OutcomeActionButton
                    orderId={id}
                    action={markRefunded}
                    buttonLabel="Refunded"
                    modalTitle="Record a full refund?"
                    description="The whole order amount was paid back to the passenger. The order keeps its status; the refund is recorded on it for the outlet and admin."
                    quickReasons={[
                      'Passenger requested a refund on the call',
                      'Order was refunded after a complaint',
                    ]}
                  />
                ) : null}
              </div>
            ) : null}
            {canFlagRating ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2 first:border-t-0 first:pt-0">
                <RatingOrderButton orderId={id} />
              </div>
            ) : null}
            {order.refund ? (
              <p className="text-sm font-semibold text-red-700">
                Refunded ₹{(order.refund.amountPaise / 100).toLocaleString('en-IN')}
              </p>
            ) : null}
            {order.ratingOrder ? <p className="text-sm text-muted">Tagged as a rating order.</p> : null}
            {noOutcomeAvailable ? (
              <span className="text-sm text-muted">
                {order.status === 'CANCELLED'
                  ? 'Already cancelled.'
                  : 'This order can no longer be updated from here.'}
              </span>
            ) : null}
          </div>
        }
      />

      {rto ? (
        <ReturnToOriginCard
          orderId={id}
          externalOrderId={order.externalOrderId}
          info={rto}
          canCollect={false}
        />
      ) : null}

      {cancelRequest ? (
        <CancelRequestCard orderId={id} request={cancelRequest} canDecide />
      ) : null}

      {isTerminal(order.status as OrderStatus) ? null : (
        <AssignRidersCard
          orderId={id}
          riders={riders}
          assigned={(order.delivery?.agentIds ?? []).map(String)}
        />
      )}

      {order.contactPhone ? (
        <Card>
          <CardHeader title="Passenger" />
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <span className="text-sm text-ink">{order.contactName ?? 'Passenger'}</span>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={`tel:${order.contactPhone}`}
                className="inline-flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-1.5 font-mono text-base font-semibold tabular-nums text-accent underline-offset-2 hover:underline"
              >
                <IconPhone size={16} aria-hidden />
                {order.contactPhone}
              </a>
              {/* The other way to reach the passenger: opens their WhatsApp
                  thread, aimed at this order, and goes there. Only for a
                  number WhatsApp could dial; a masked or partial one gets
                  the call link alone. */}
              {normalisePhone(order.contactPhone) ? <OpenChatButton orderId={id} basePath="/calls/chat" /> : null}
            </div>
          </div>
        </Card>
      ) : (
        <Notice tone="warn">
          No phone number came in with this order, so there is nobody to ring from here.
        </Notice>
      )}

      {order.remark ? (
        <Card>
          <CardHeader title="Remark from admin" />
          <p className="m-4 whitespace-pre-wrap rounded-lg bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 ring-1 ring-inset ring-amber-200">
            {order.remark}
          </p>
        </Card>
      ) : null}

      {order.notes ? (
        <Card>
          <CardHeader title="Notes" />
          <p className="whitespace-pre-wrap px-4 py-3 text-sm text-muted">{order.notes}</p>
        </Card>
      ) : null}

      {/* Unconditional, like Call log below: the box to add one has to be
          here when there is no note yet, which is its most common state. This
          is not the read-only "Notes" card above — that one is set once at
          creation and never changes; this one is what a telecaller writes for
          the kitchen to see on the printed KOT. */}
      <Card>
        <CardHeader title="KOT note" />
        <KotNoteForm orderId={id} kotNote={order.kotNote ?? null} />
      </Card>

      {/* Unconditional, unlike the cards above: the composer has to be here
          when the log is empty, which is its most common state. */}
      <Card>
        <CardHeader title="Call log" />
        <CallLog orderId={id} notes={viewCallNotes(ctx, callLog, actorLabel)} />
        <div className="border-t border-line">
          <CallNoteForm orderId={id} />
        </div>
      </Card>

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
