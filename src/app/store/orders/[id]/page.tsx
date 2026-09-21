import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/session'
import { findById, viewCallNotes } from '@/lib/repo/orderRepo'
import { connectDb } from '@/lib/db'
import { User } from '@/lib/models'
import { toCardData } from '@/lib/orderView'
import { ROLE_LABEL } from '@/lib/roles'
import { BackLink, Card, CardHeader } from '@/components/ui'
import { OrderCard } from '@/components/OrderCard'
import { EventLog } from '@/components/EventLog'
import { CallLog } from '@/components/CallLog'
import { AcceptButton, GenerateKotButton, MarkPreparedButton, PreviewKotLink } from '../../StoreOrderActions'

export default async function StoreOrderDetail(props: PageProps<'/store/orders/[id]'>) {
  const ctx = await requireRole('STORE_MANAGER', 'ADMIN')
  const { id } = await props.params

  // Scoped read: another outlet's id is a miss here, not a permission error.
  const order = await findById(ctx, id)
  if (!order) notFound()

  await connectDb()
  // Both logs draw their authors from one query. `?? []` because findById is
  // .lean(), which skips the schema's `default: []` — callLog is genuinely
  // undefined on orders written before the field existed, and the type says
  // otherwise.
  const callLog = order.callLog ?? []
  const actorIds = [...order.events.map((e) => e.userId), ...callLog.map((n) => n.userId)].filter(
    (v): v is NonNullable<typeof v> => Boolean(v),
  )
  const actors = await User.find({ _id: { $in: actorIds } }).select('name role').lean()
  const actorName = new Map(actors.map((a) => [String(a._id), a.name]))
  // The call log names the role too: a manager reading a note cares whether it
  // came from the call desk or from an admin.
  const actorLabel = new Map(
    actors.map((a) => [String(a._id), `${a.name} · ${ROLE_LABEL[a.role] ?? a.role}`]),
  )

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <BackLink href="/store">Back to the board</BackLink>

      <OrderCard
        order={toCardData(order)}
        href={`/store/orders/${id}`}
        showServiceDate
        actions={
          <>
            {order.status === 'RECEIVED' ? <AcceptButton orderId={id} /> : null}
            {order.status === 'ACCEPTED' ? (
              <>
                <PreviewKotLink orderId={id} />
                <GenerateKotButton orderId={id} />
              </>
            ) : null}
            {order.status === 'KOT_PRINTED' ? (
              <>
                <PreviewKotLink orderId={id} />
                <GenerateKotButton orderId={id} isReprint />
                <MarkPreparedButton orderId={id} />
              </>
            ) : null}
            {order.status === 'PREPARED' ? (
              <>
                <PreviewKotLink orderId={id} />
                <GenerateKotButton orderId={id} isReprint />
                <span className="text-sm font-medium text-emerald-700">On the shelf, waiting for the rider</span>
              </>
            ) : null}
          </>
        }
      />

      {order.contactPhone ? (
        <Card>
          <CardHeader title="Passenger" />
          <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <span className="text-ink">{order.contactName ?? 'Passenger'}</span>
            <a href={`tel:${order.contactPhone}`} className="font-mono font-medium tabular-nums text-accent underline-offset-2 hover:underline">
              {order.contactPhone}
            </a>
          </div>
        </Card>
      ) : null}

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

      {/* Read-only here: the composer lives on the telecaller's and admin's
          own pages. An admin viewing this console gets the same read-only
          rendering, which is correct: they have the box on /admin. */}
      {callLog.length > 0 ? (
        <Card>
          <CardHeader title="Call log" />
          <CallLog orderId={id} notes={viewCallNotes(ctx, callLog, actorLabel)} />
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
