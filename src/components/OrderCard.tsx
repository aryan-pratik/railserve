import Link from 'next/link'
import { formatIST, formatMoney, formatServiceDate } from '@/lib/format'
import { Card, StatusBadge, TypeBadge } from '@/components/ui'
import { ReadyByCountdown } from '@/components/ReadyByCountdown'

export type OrderCardData = {
  id: string
  externalOrderId: string
  orderType: string
  status: string
  trainNo: string | null
  trainName: string | null
  rawSeat: string | null
  handoverPoint: string | null
  pax: number | null
  scheduledArrival: string | null
  readyBy: string | null
  serviceDate: string
  amountPaise: number | null
  paymentMode: string | null
  items: { id: string; name: string; qty: number; spec: string | null; isPacking: boolean }[]
  createdAt: string
}

export function OrderCard({
  order, href, actions, showServiceDate = false,
}: {
  order: OrderCardData
  href: string
  actions?: React.ReactNode
  showServiceDate?: boolean
}) {
  const kitchen = order.items.filter((i) => !i.isPacking)
  const packing = order.items.filter((i) => i.isPacking)
  const cod = order.paymentMode === 'COD'

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
        <Link href={href} className="font-semibold text-slate-900 underline-offset-2 hover:underline">
          {order.externalOrderId}
        </Link>
        <TypeBadge type={order.orderType} />
        <StatusBadge status={order.status} />
        {order.readyBy ? <ReadyByCountdown readyBy={order.readyBy} /> : null}
        <span className="ml-auto text-xs text-slate-500">
          {showServiceDate ? formatServiceDate(order.serviceDate) : formatIST(order.createdAt)}
        </span>
      </div>

      <div className="grid gap-4 p-4 sm:grid-cols-2">
        <div className="space-y-1 text-sm">
          {order.trainNo ? (
            <div>
              <span className="font-semibold text-slate-900">{order.trainNo}</span>{' '}
              <span className="text-slate-600">{order.trainName}</span>
            </div>
          ) : (
            <div className="text-slate-400">No train number</div>
          )}
          <div className="text-slate-600">
            {order.orderType === 'BULK' ? (
              <>
                <span className="font-medium text-slate-900">{order.pax} pax</span>
                {order.handoverPoint ? ` · ${order.handoverPoint}` : ''}
              </>
            ) : (
              <>Seat <span className="font-medium text-slate-900">{order.rawSeat ?? '—'}</span></>
            )}
          </div>
          <div className="text-xs text-slate-500">Arrives {formatIST(order.scheduledArrival)}</div>
        </div>

        <div className="text-sm">
          <ul className="space-y-0.5">
            {kitchen.map((i) => (
              <li key={i.id} className="text-slate-800">
                <span className="font-semibold tabular-nums">{i.qty}×</span> {i.name}
                {i.spec ? (
                  <div className="mt-1 whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs text-slate-600">
                    {i.spec}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {packing.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {packing.map((i) => (
                <span key={i.id} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  {i.name} ×{i.qty}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 px-4 py-3">
        <span
          className={`rounded px-2 py-1 text-sm font-bold ${
            cod ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700'
          }`}
        >
          {cod ? `COLLECT ${formatMoney(order.amountPaise)}` : `${order.paymentMode ?? '—'} · ${formatMoney(order.amountPaise)}`}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
      </div>
    </Card>
  )
}
