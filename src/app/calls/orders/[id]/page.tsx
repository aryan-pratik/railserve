import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/session'
import { findById, viewCallNotes } from '@/lib/repo/orderRepo'
import { connectDb } from '@/lib/db'
import { User } from '@/lib/models'
import { toCardData } from '@/lib/orderView'
import { allowedNextStatuses, type OrderStatus } from '@/lib/orderStatus'
import { ROLE_LABEL } from '@/lib/roles'
import { BackLink, Card, CardHeader, Notice } from '@/components/ui'
import { OrderCard } from '@/components/OrderCard'
import { EventLog } from '@/components/EventLog'
import { CallLog } from '@/components/CallLog'
import { CallNoteForm } from '@/components/CallNoteForm'
import { IconPhone } from '@/components/Icons'
import { CancelOrderButton } from '../../CancelOrderButton'

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
  const actors = await User.find({ _id: { $in: actorIds } }).select('name role').lean()
  const actorName = new Map(actors.map((a) => [String(a._id), a.name]))
  // Only the call log carries the role: both a telecaller and an admin write
  // there, and a manager reading a note cares which. The event log's actors
  // are already unambiguous from the transition itself.
  const actorLabel = new Map(
    actors.map((a) => [String(a._id), `${a.name} · ${ROLE_LABEL[a.role] ?? a.role}`]),
  )

  // The allow-list decides, not this page. If TRANSITIONS ever changes, the
  // button follows it rather than drifting from it.
  const canCancel = allowedNextStatuses(order.status as OrderStatus, 'TELECALLER').includes(
    'CANCELLED',
  )

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <BackLink href="/calls">Back to the call list</BackLink>

      <OrderCard
        order={toCardData(order)}
        href={`/calls/orders/${id}`}
        showServiceDate
        showMoney={false}
        actions={
          canCancel ? (
            <CancelOrderButton orderId={id} externalOrderId={order.externalOrderId} />
          ) : (
            <span className="text-sm text-muted">
              {order.status === 'CANCELLED'
                ? 'Already cancelled.'
                : order.status === 'DISPATCHED'
                  ? 'A rider is already carrying this: call the outlet instead.'
                  : 'This order can no longer be cancelled from here.'}
            </span>
          )
        }
      />

      {order.contactPhone ? (
        <Card>
          <CardHeader title="Passenger" />
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <span className="text-sm text-ink">{order.contactName ?? 'Passenger'}</span>
            <a
              href={`tel:${order.contactPhone}`}
              className="inline-flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-1.5 font-mono text-base font-semibold tabular-nums text-accent underline-offset-2 hover:underline"
            >
              <IconPhone size={16} aria-hidden />
              {order.contactPhone}
            </a>
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
