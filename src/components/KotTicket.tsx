import { Fragment } from 'react'
import Image from 'next/image'
import { formatIST, formatMoney, formatServiceDate, formatTimeIST } from '@/lib/format'
import { sourceLabel } from '@/lib/orderEnums'
import { isMenuDish, splitKotParts, type DietLookup, type KotPart } from '@/lib/diet'
import { DietMark } from './DietMark'

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
 * Non-veg is always its own KOT. An order carrying both prints the pair
 * twice, veg first and then non-veg, because the two are cooked and packed at
 * different stations (lib/diet.ts splitKotParts). Which is which comes from
 * the menu database, never from reading the item's name here. Each ticket
 * says VEG or NON-VEG beside a circle or a triangle, and every item carries
 * the same shape: thermal paper has no colour, so the shape is the signal.
 * A shape followed by "?" is a tag nobody has confirmed on the Menu page yet;
 * a "?" alone is an item with no tag at all. Both print a line saying so.
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
  /** Stamped on every ticket as data-order-id, which the print queue checks the render by. */
  _id: unknown
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
  /** When the kitchen must have it done. Printed for local orders, which have no arrival. */
  readyBy?: Maybe<Date>
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
    /** Veg / non-veg set on this order itself. Wins over the menu (lib/diet.ts tagFor). */
    diet?: Maybe<string>
  }[]
}

type KotItem = KotOrder['items'][number]
type Part = KotPart<KotItem>

/** "VEG" / "NON-VEG" with its shape, as the ticket's heading says it. */
function PartLabel({ part, size = 14 }: { part: Part; size?: number }) {
  // Untagged food rides on the veg ticket, but a ticket carrying nothing
  // else must not call itself VEG: nobody has said that it is.
  const food = part.items.filter((i) => !i.isPacking)
  const unknown = part.diet === 'VEG' && food.length > 0 && food.every((i) => i.diet === null)
  return (
    <span className="inline-flex items-center gap-1">
      <DietMark diet={unknown ? null : part.diet} size={size} print />
      <span>{unknown ? 'NOT TAGGED' : part.diet === 'VEG' ? 'VEG' : 'NON-VEG'}</span>
    </span>
  )
}

/**
 * One item's mark. A tag that is only a suggestion prints its shape and a
 * "?" after it. `wide` reserves the room for that "?" on every row of a
 * ticket that has one, so the quantities stay in one column.
 */
function ItemMark({ item, wide }: { item: Part['items'][number]; wide: boolean }) {
  return (
    <span className={`mt-px inline-flex shrink-0 items-start ${wide ? 'w-[21px]' : ''}`}>
      <DietMark diet={item.diet} size={13} print />
      {item.diet && !item.confirmed ? <span className="text-[12px] font-bold leading-[13px]">?</span> : null}
    </span>
  )
}

/** The lines under the items that say what a "?" means. Nothing when every tag is confirmed. */
function MarkNotes({ items }: { items: Part['items'] }) {
  const untagged = items.some((i) => i.diet === null)
  const unconfirmed = items.some((i) => i.diet !== null && !i.confirmed)
  if (!untagged && !unconfirmed) return null
  return (
    <div className="mt-1.5 text-[11px] font-bold">
      {untagged ? <div>? ALONE = NOT TAGGED VEG / NON-VEG. CHECK.</div> : null}
      {unconfirmed ? <div>? AFTER MARK = TAG NOT CONFIRMED. CHECK.</div> : null}
    </div>
  )
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

export function KotTicket({ order, outlet, part }: { order: KotOrder; outlet: KotOutlet; part: Part }) {
  const kitchen = part.items.filter((i) => !i.isPacking)
  const packing = part.items.filter((i) => i.isPacking)
  const wideMarks = kitchen.some((i) => i.diet !== null && !i.confirmed)
  const isBulk = order.orderType === 'BULK'
  const isLocal = order.orderType === 'LOCAL'
  // The PAX box prints once per order, on the ticket that carries the thali
  // (the one line that is not a menu dish). On a split order that may be the
  // second ticket. An order with no such line shows it on the first.
  const isThali = (i: KotItem) => !i.isPacking && !isMenuDish(i)
  const paxHere = order.items.some(isThali) ? kitchen.some(isThali) : part.index === 1

  return (
    <div className={TICKET_CLASS} data-order-id={String(order._id)}>
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
        <span className="inline-flex items-center gap-1.5 text-[14px]">
          KOT <PartLabel part={part} size={15} />
        </span>
        <span className="text-[14px]">{order.externalOrderId}</span>
      </div>
      {part.of > 1 ? (
        <div className="my-1 border border-black py-0.5 text-center text-[12px] font-bold">
          KOT {part.index} OF {part.of} FOR THIS ORDER
        </div>
      ) : null}
      <div className="flex items-center justify-between">
        <span>{order.orderType}</span>
        <span>{formatServiceDate(order.serviceDate)}</span>
      </div>

      <Rule />

      {isLocal ? (
        <>
          <Line label="Local" value={order.handoverPoint ?? '-'} />
          <Line label="Ready" value={formatTimeIST(order.readyBy)} />
        </>
      ) : (
        <Line
          label="Train"
          value={order.trainNo ? `${order.trainNo} ${order.trainName ?? ''}`.trim() : 'NOT SPECIFIED'}
        />
      )}
      {isLocal ? null : isBulk ? (
        <>
          <Line label="Pax" value={String(order.pax ?? '-')} />
          <Line label="Handover" value={order.handoverPoint ?? '-'} />
        </>
      ) : (
        <Line label="Seat" value={order.rawSeat ?? '-'} />
      )}
      {isLocal ? null : <Line label="Arrives" value={formatTimeIST(order.scheduledArrival)} />}
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
      {/* Once per order: on both KOTs of a split order the same box would
          read as a second lot of plates. */}
      {isBulk && order.pax && paxHere ? (
        <div className="my-1 border border-black py-1 text-center text-[15px] font-bold">
          {order.pax} PAX
        </div>
      ) : null}
      <ul className="mt-1 space-y-1.5">
        {kitchen.map((i) => (
          <li key={String(i._id)}>
            <div className="flex gap-1.5">
              <ItemMark item={i} wide={wideMarks} />
              <span className="w-8 shrink-0 text-[13px] font-bold tabular-nums">{i.qty}×</span>
              <span className="font-bold uppercase">{i.name}</span>
            </div>
            {/* The composite thali text, printed once, verbatim. */}
            {i.spec ? (
              <pre className={`${wideMarks ? 'ml-[3.75rem]' : 'ml-[3.25rem]'} mt-0.5 whitespace-pre-wrap break-words font-kot text-[11px]`}>
                {i.spec}
              </pre>
            ) : null}
            {i.notes ? <div className={`${wideMarks ? 'ml-[3.75rem]' : 'ml-[3.25rem]'} text-[11px] italic`}>note: {i.notes}</div> : null}
          </li>
        ))}
      </ul>
      <MarkNotes items={kitchen} />

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

      {/* The amount is the whole order's, so it is printed once. On the
          second KOT of a split order it would read as a second sum to
          collect. */}
      <div className="flex items-center justify-between text-[13px] font-bold">
        <span>{order.paymentMode ?? '-'}</span>
        <span>{part.index === 1 ? formatMoney(order.amountPaise) : 'TOTAL ON KOT 1'}</span>
      </div>

      {order.paymentMode === 'COD' && part.index === 1 ? (
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
export function KotSlip({ order, part }: { order: KotOrder; part: Part }) {
  const food = part.items.filter((i) => !i.isPacking)
  const wideMarks = food.some((i) => i.diet !== null && !i.confirmed)
  const isBulk = order.orderType === 'BULK'
  const isLocal = order.orderType === 'LOCAL'

  return (
    <div className={TICKET_CLASS} data-order-id={String(order._id)}>
      <div className="text-center text-[18px] font-bold">{order.externalOrderId}</div>
      <div className="flex items-center justify-center gap-2 text-[13px] font-bold">
        <PartLabel part={part} />
        {part.of > 1 ? <span>· BAG {part.index} OF {part.of}</span> : null}
      </div>

      <Rule />

      {isLocal ? (
        <Line label="Local" value={order.handoverPoint ?? '-'} />
      ) : (
        <Line label="Train" value={order.trainNo ?? 'NOT SPECIFIED'} />
      )}
      {isLocal ? null : isBulk ? (
        <Line label="Handover" value={order.handoverPoint ?? '-'} />
      ) : (
        <Line label="Seat" value={order.rawSeat ?? '-'} />
      )}
      <Line label="From" value={sourceLabel(order.source)} />

      <Rule />

      <ul className="space-y-0.5">
        {food.map((i) => (
          <li key={String(i._id)} className="flex gap-1.5">
            <ItemMark item={i} wide={wideMarks} />
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
 * this rather than the tickets one by one, so the preview, the print and the
 * ticket count in printer/queue.ts cannot drift apart.
 *
 * `lookup` is the menu database's veg / non-veg tags for this order's items
 * (menuRepo.dietLookupFor). One part for an order that is all veg or all
 * non-veg; two, veg then non-veg, for one that carries both.
 */
export function KotTickets({
  order,
  outlet,
  lookup,
}: {
  order: KotOrder
  outlet: KotOutlet
  lookup: DietLookup
}) {
  return (
    <>
      {splitKotParts(lookup, order.source, order.items).map((part) => (
        <Fragment key={part.diet}>
          <KotTicket order={order} outlet={outlet} part={part} />
          <KotSlip order={order} part={part} />
        </Fragment>
      ))}
    </>
  )
}
