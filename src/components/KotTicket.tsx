import { formatIST, formatMoney, formatServiceDate, formatTimeIST } from '@/lib/format'

/**
 * Kitchen Order Ticket. Plan §10.
 *
 * Sized for 80mm thermal paper, monospace, pure black on white — thermal heads
 * render greys as mush, so nothing here relies on colour or shading. Two
 * sections, because the packing items are what get forgotten on a large order
 * and they belong to a different person than the cooking does.
 *
 * One ticket per order, always. A batch print stacks these; globals.css puts a
 * page break between them so the printer cuts between dockets.
 */

/**
 * Written to accept a lean Mongoose document directly: every nullable column
 * arrives as an optional property typed `T | null | undefined`, so the props
 * are declared the same way rather than forcing a normalising pass at each of
 * the two call sites.
 */
type Maybe<T> = T | null | undefined

export type KotOrder = {
  externalOrderId: string
  orderType: string
  stationCode: string
  serviceDate: string
  trainNo?: Maybe<string>
  trainName?: Maybe<string>
  rawSeat?: Maybe<string>
  handoverPoint?: Maybe<string>
  pax?: Maybe<number>
  scheduledArrival?: Maybe<Date>
  readyBy?: Maybe<Date>
  notes?: Maybe<string>
  paymentMode?: Maybe<string>
  amountPaise?: Maybe<number>
  items: {
    _id: unknown
    name: string
    qty: number
    spec?: Maybe<string>
    isPacking: boolean
    notes?: Maybe<string>
  }[]
}

export type KotOutlet = { name: string; stationName?: Maybe<string> } | null

function Rule() {
  return <div aria-hidden className="my-1.5 border-t border-dashed border-black" />
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 leading-snug">
      <span className="w-14 shrink-0">{label}</span>
      <span className="font-bold">{value}</span>
    </div>
  )
}

export function KotTicket({ order, outlet }: { order: KotOrder; outlet: KotOutlet }) {
  const kitchen = order.items.filter((i) => !i.isPacking)
  const packing = order.items.filter((i) => i.isPacking)
  const isBulk = order.orderType === 'BULK'

  return (
    <div className="kot w-[80mm] max-w-full bg-white p-3 font-mono text-[12px] leading-tight text-black shadow-sm print:shadow-none">
      <div className="text-center">
        <div className="text-[14px] font-bold uppercase">{outlet?.name ?? 'OUTLET'}</div>
        <div className="uppercase">
          {outlet?.stationName ?? ''} ({order.stationCode})
        </div>
      </div>

      <Rule />

      <div className="flex items-center justify-between font-bold">
        <span className="text-[14px]">KOT</span>
        <span className="text-[14px]">{order.externalOrderId}</span>
      </div>
      <div className="flex items-center justify-between">
        <span>{order.orderType}</span>
        <span>{formatServiceDate(order.serviceDate)}</span>
      </div>

      <Rule />

      <Line
        label="Train"
        value={order.trainNo ? `${order.trainNo} ${order.trainName ?? ''}`.trim() : 'NOT SPECIFIED'}
      />
      {isBulk ? (
        <>
          <Line label="Pax" value={String(order.pax ?? '—')} />
          <Line label="Handover" value={order.handoverPoint ?? '—'} />
        </>
      ) : (
        <Line label="Seat" value={order.rawSeat ?? '—'} />
      )}
      <Line label="Arrives" value={formatTimeIST(order.scheduledArrival)} />
      {order.readyBy ? <Line label="READY BY" value={formatTimeIST(order.readyBy)} /> : null}

      <Rule />

      <div className="text-[13px] font-bold">KITCHEN</div>
      {isBulk && order.pax ? (
        <div className="my-1 border border-black py-1 text-center text-[15px] font-bold">
          {order.pax} PAX
        </div>
      ) : null}
      <ul className="mt-1 space-y-1.5">
        {kitchen.map((i) => (
          <li key={String(i._id)}>
            <div className="flex gap-2">
              <span className="w-8 shrink-0 text-[13px] font-bold tabular-nums">{i.qty}×</span>
              <span className="font-bold uppercase">{i.name}</span>
            </div>
            {/* The composite thali text, printed once, verbatim. */}
            {i.spec ? (
              <pre className="ml-8 mt-0.5 whitespace-pre-wrap break-words font-mono text-[11px]">
                {i.spec}
              </pre>
            ) : null}
            {i.notes ? <div className="ml-8 text-[11px] italic">note: {i.notes}</div> : null}
          </li>
        ))}
      </ul>

      {packing.length > 0 ? (
        <>
          <Rule />
          <div className="text-[13px] font-bold">PACKING</div>
          <ul className="mt-1 space-y-0.5">
            {packing.map((i) => (
              <li key={String(i._id)} className="flex gap-2">
                <span className="w-8 shrink-0 tabular-nums">{i.qty}×</span>
                <span className="uppercase">{i.name}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {order.notes ? (
        <>
          <Rule />
          <div className="text-[11px]">
            <span className="font-bold">NOTE: </span>
            {order.notes}
          </div>
        </>
      ) : null}

      <Rule />

      <div className="flex items-center justify-between text-[13px] font-bold">
        <span>{order.paymentMode ?? '—'}</span>
        <span>{formatMoney(order.amountPaise)}</span>
      </div>

      <Rule />

      <div className="text-center text-[10px]">Printed {formatIST(new Date())}</div>
    </div>
  )
}
