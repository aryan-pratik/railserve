import Image from 'next/image'
import { formatIST, formatMoney, formatServiceDate, formatTimeIST } from '@/lib/format'
import { sourceLabel } from '@/lib/orderEnums'

/**
 * Kitchen Order Ticket. Plan §10.
 *
 * Sized for 80mm thermal paper, pure black on white — thermal heads
 * render greys as mush, so nothing here relies on colour or shading. Two
 * sections, because the packing items are what get forgotten on a large order
 * and they belong to a different person than the cooking does.
 *
 * Every order prints as two tickets, each its own cut (see KotTickets below):
 * this one for the kitchen, and a short bag slip. A batch print stacks them;
 * the print queue sends each as its own job so the printer cuts between them.
 *
 * Set in Inter, at medium weight. The ticket is printed as a 576-dot 1-bit
 * image, so a digit is about 16 dots tall and what survives is its outline,
 * not its detail. Both monospace faces tried here failed on the 0: JetBrains
 * Mono marks it (a dot or slash that fills in), and Space Mono draws 0 and 8
 * as the same rounded box with small holes, so either way the 0 read as an 8.
 * Inter's 0 is an open oval and its 8 is pinched at the waist, so the two
 * differ in outline. Medium rather than regular because one-dot strokes print
 * faint.
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
  /** The aggregator the order came through — see orderEnums.ts. */
  source?: Maybe<string>
  stationCode: string
  serviceDate: string
  trainNo?: Maybe<string>
  trainName?: Maybe<string>
  rawSeat?: Maybe<string>
  handoverPoint?: Maybe<string>
  pax?: Maybe<number>
  scheduledArrival?: Maybe<Date>
  contactName?: Maybe<string>
  contactPhone?: Maybe<string>
  notes?: Maybe<string>
  /** A telecaller's (or admin's) instruction, printed prominently — see Order.kotNote. */
  kotNote?: Maybe<string>
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

/**
 * Shared by both tickets. `.kot` is what the screenshot step captures, one
 * image (and so one cut) per element. font-feature-settings is reset because
 * the body turns on "zero" app-wide, which would slash Inter's zero too.
 * tabular-nums keeps digits on a fixed pitch now that the face is proportional.
 */
const TICKET_CLASS =
  'kot w-[80mm] max-w-full bg-white p-3 font-kot font-medium tabular-nums [font-feature-settings:normal] text-[12px] leading-tight text-black shadow-sm print:shadow-none'

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
    <div className={TICKET_CLASS}>
      <div className="text-center">
        {/* Which brand's ticket this is. Several brands share one printer at
            a station, so this is the routing label the kitchen reads first -
            and the fallback is reachable now that an order with no matched
            outlet still prints. */}
        <div className="text-[14px] font-bold uppercase">
          {outlet?.name ?? 'UNMATCHED: CHECK APP'}
        </div>
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
          <Line label="Pax" value={String(order.pax ?? '-')} />
          <Line label="Handover" value={order.handoverPoint ?? '-'} />
        </>
      ) : (
        <Line label="Seat" value={order.rawSeat ?? '-'} />
      )}
      <Line label="Arrives" value={formatTimeIST(order.scheduledArrival)} />
      <Line label="Name" value={order.contactName ?? '-'} />
      <Line label="Phone" value={order.contactPhone ?? '-'} />

      {/* Boxed like the PAX count below, for the same reason: this is the one
          line on the ticket someone decided the kitchen must not miss, so it
          gets the ticket's own language for "important" rather than a new one.
          Placed above KITCHEN, not down by the low-emphasis NOTE: block near
          the footer — those are two different fields (Order.notes vs
          Order.kotNote) and this one is the one meant to be seen first. */}
      {order.kotNote ? (
        <>
          <Rule />
          <div className="my-1 border border-black px-2 py-1">
            <div className="text-[12px] font-bold uppercase tracking-wide">KOT Note</div>
            <div className="whitespace-pre-wrap break-words text-[12px] font-bold leading-snug">
              {order.kotNote}
            </div>
          </div>
        </>
      ) : null}

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
              <pre className="ml-8 mt-0.5 whitespace-pre-wrap break-words font-kot text-[11px]">
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
        <span>{order.paymentMode ?? '-'}</span>
        <span>{formatMoney(order.amountPaise)}</span>
      </div>

      {order.paymentMode === 'COD' ? (
        <>
          <Rule />
          <div className="flex flex-col items-center gap-1 text-center">
            <Image src="/kot-cod-qr.png" alt="UPI QR code" width={112} height={112} priority className="h-28 w-28" />
            <div className="text-[11px] font-bold">Support: 9288091593</div>
          </div>
        </>
      ) : null}

      <Rule />

      <div className="text-center text-[10px]">Printed {formatIST(new Date())}</div>
    </div>
  )
}

/**
 * The second ticket: what goes on the bag. Train, seat, order id, aggregator
 * and the food, and nothing else — the rider and the hand-off need to match a
 * bag to a seat at a glance, not read a kitchen docket.
 */
export function KotSlip({ order }: { order: KotOrder }) {
  const food = order.items.filter((i) => !i.isPacking)
  const isBulk = order.orderType === 'BULK'

  return (
    <div className={TICKET_CLASS}>
      <div className="text-center text-[18px] font-bold">{order.externalOrderId}</div>

      <Rule />

      <Line label="Train" value={order.trainNo ?? 'NOT SPECIFIED'} />
      {isBulk ? (
        <Line label="Handover" value={order.handoverPoint ?? '-'} />
      ) : (
        <Line label="Seat" value={order.rawSeat ?? '-'} />
      )}
      <Line label="From" value={sourceLabel(order.source)} />

      <Rule />

      <ul className="space-y-0.5">
        {food.map((i) => (
          <li key={String(i._id)} className="flex gap-2">
            <span className="w-8 shrink-0 font-bold tabular-nums">{i.qty}×</span>
            <span className="font-bold uppercase">{i.name}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Everything one order prints, in print order. Every KOT surface renders
 * this rather than the tickets one by one, so the preview, the print and
 * TICKETS_PER_ORDER in printer/queue.ts cannot drift apart.
 */
export function KotTickets({ order, outlet }: { order: KotOrder; outlet: KotOutlet }) {
  return (
    <>
      <KotTicket order={order} outlet={outlet} />
      <KotSlip order={order} />
    </>
  )
}
