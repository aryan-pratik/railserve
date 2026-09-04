import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/session'
import { findById } from '@/lib/repo/orderRepo'
import { connectDb } from '@/lib/db'
import { User } from '@/lib/models'
import { toCardData } from '@/lib/orderView'
import { Card, CardHeader } from '@/components/ui'
import { OrderCard } from '@/components/OrderCard'
import { EventLog } from '@/components/EventLog'
import { AcceptButton, GenerateKotButton, MarkPreparedButton } from '../../StoreOrderActions'

export default async function StoreOrderDetail(props: PageProps<'/store/orders/[id]'>) {
  const ctx = await requireRole('STORE_MANAGER', 'ADMIN')
  const { id } = await props.params

  // Scoped read: another outlet's id is a miss here, not a permission error.
  const order = await findById(ctx, id)
  if (!order) notFound()

  await connectDb()
  const actorIds = order.events
    .map((e) => e.userId)
    .filter((v): v is NonNullable<typeof v> => Boolean(v))
  const actors = await User.find({ _id: { $in: actorIds } }).select('name').lean()
  const actorName = new Map(actors.map((a) => [String(a._id), a.name]))

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href="/store" className="text-sm text-muted underline-offset-2 hover:underline">
        ← Back to the board
      </Link>

      <OrderCard
        order={toCardData(order)}
        href={`/store/orders/${id}`}
        showServiceDate
        actions={
          <>
            {order.status === 'RECEIVED' ? <AcceptButton orderId={id} /> : null}
            {order.status === 'ACCEPTED' ? <GenerateKotButton orderId={id} /> : null}
            {order.status === 'KOT_PRINTED' ? (
              <>
                <GenerateKotButton orderId={id} reprint />
                <MarkPreparedButton orderId={id} />
              </>
            ) : null}
            {order.status === 'PREPARED' ? (
              <>
                <GenerateKotButton orderId={id} reprint />
                <span className="text-sm font-medium text-emerald-700">
                  On the ready shelf — waiting for the rider
                </span>
              </>
            ) : null}
          </>
        }
      />

      {order.contactPhone ? (
        <Card>
          <CardHeader title="Passenger" />
          <div className="flex items-center justify-between px-4 py-3 text-sm">
            <span className="text-muted">{order.contactName ?? '—'}</span>
            <a href={`tel:${order.contactPhone}`} className="font-mono font-medium text-accent hover:underline">
              {order.contactPhone}
            </a>
          </div>
        </Card>
      ) : null}

      {order.remark ? (
        <Card>
          <CardHeader title="Remark from admin" />
          <p className="m-4 whitespace-pre-wrap rounded-lg bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
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
