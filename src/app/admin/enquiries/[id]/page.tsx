import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/session'
import { findById } from '@/lib/repo/orderRepo'
import { connectDb } from '@/lib/db'
import { Restaurant, User } from '@/lib/models'
import { formatIST, formatMoney, formatServiceDate, paiseToRupees, utcToIstLocal } from '@/lib/format'
import { Button, ButtonLink, Card, CardHeader, Dash, Notice, PageHeader, StatusBadge, TypeBadge } from '@/components/ui'
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

  const summary: [string, React.ReactNode][] = [
    ['Payment', order.paymentMode ? order.paymentMode.charAt(0) + order.paymentMode.slice(1).toLowerCase() : null],
    ['Ready by', formatIST(order.readyBy)],
    ['Handover', order.handoverPoint ?? null],
    ['Contact', order.contactPhone ? `${order.contactName ?? ''} ${order.contactPhone}`.trim() : null],
  ]

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        back={{ href: '/admin/enquiries', label: 'All enquiries' }}
        title={<span className="font-mono">{order.externalOrderId}</span>}
        badges={<><TypeBadge type={order.orderType} /><StatusBadge status={order.status} /></>}
        note={
          <>
            <span className="tabular-nums">{formatServiceDate(order.serviceDate)}</span> ·{' '}
            <span className="font-mono">{order.stationCode}</span>
            {order.pax ? <> · <span className="tabular-nums">{order.pax}</span> pax</> : null}
          </>
        }
      />

      {order.status === 'RECEIVED' ? (
        <Notice tone="success">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Confirmed and live on the outlet board.</span>
            <ButtonLink href={`/admin/orders/${id}`} size="sm">Open the order</ButtonLink>
          </div>
        </Notice>
      ) : null}

      {menu ? (
        <Card>
          <CardHeader title="Menu as requested" />
          <pre className="whitespace-pre-wrap px-4 py-3 font-sans text-sm text-muted">{menu}</pre>
        </Card>
      ) : null}

      {open ? (
        <>
          <QuoteForm
            orderId={id}
            outlets={outlets.map((o) => ({ id: String(o._id), label: `${o.name} · ${o.stationCode}` }))}
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
            <Button type="submit" variant="danger" size="sm">Mark lost</Button>
          </form>
        </>
      ) : null}

      <Card>
        <CardHeader title="Quote summary" />
        <div className="flex items-baseline justify-between gap-4 border-b border-line px-4 py-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">Amount</span>
          <span className="text-2xl font-semibold tabular-nums text-ink">{formatMoney(order.amountPaise ?? null)}</span>
        </div>
        <div className="divide-y divide-line text-sm">
          {summary.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 px-4 py-2.5">
              <span className="text-muted">{k}</span>
              <span className="text-right font-medium text-ink">{v ?? <Dash />}</span>
            </div>
          ))}
        </div>
      </Card>

      {pasted ? (
        <Card>
          <CardHeader title="Original message" />
          <details className="px-4 py-3">
            <summary className="cursor-pointer text-sm text-muted hover:text-ink">What was actually sent</summary>
            <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-line bg-sunken/60 p-3 font-mono text-xs text-muted">{pasted}</pre>
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
