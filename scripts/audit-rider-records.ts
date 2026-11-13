/**
 * Checks rider and cash records for the contradictions the rider ledger was
 * built to stop, and optionally fills in who carried each older order.
 *
 * Read-only unless --apply is given. What it reports:
 *
 *   1. Delivered orders that still have a return on them (a return was
 *      opened, and the order was later marked delivered).
 *   2. COD deliveries where the cash recorded is not the bill.
 *   3. COD deliveries with no cash amount or no named holder.
 *   4. Orders assigned to a rider who is not at the order's outlet. These
 *      were invisible in that rider's app.
 *   5. Live orders assigned to a rider but booked for a day other than
 *      today, which the app used to hide.
 *   6. Closed orders offered to several riders with nothing saying which of
 *      them carried it.
 *   7. Orders sitting in a status the reports cannot classify.
 *
 * With --apply it writes exactly one thing: `delivery.pickedUpBy` on orders
 * that left the counter before that field existed, where the carrier is not
 * in doubt (one rider assigned, or cash already charged to one of them, or
 * the handover event names them). Ambiguous orders are listed and left alone.
 *
 *   npm run audit:riders                       # last 30 days, report only
 *   npm run audit:riders -- --days=90
 *   npm run audit:riders -- --apply            # also backfill the carrier
 *
 * To run against production, set MONGODB_URI in the shell (see
 * scripts/backfill-payments.ts for why that wins over .env.local).
 */
import mongoose from 'mongoose'
import { connectDb, disconnectDb } from '../src/lib/db'
import { Order, User } from '../src/lib/models'
import { ORDER_STATUSES } from '../src/lib/orderStatus'
import { todayIST } from '../src/lib/format'
import { opsDayOf } from '../src/lib/opsDay'

const APPLY = process.argv.includes('--apply')
const DAYS = Number(process.argv.find((a) => a.startsWith('--days='))?.split('=')[1] ?? 30)
const SHOW = 15

type Row = {
  _id: mongoose.Types.ObjectId
  externalOrderId?: string
  status: string
  serviceDate: string
  restaurantId: mongoose.Types.ObjectId
  paymentMode?: string
  amountPaise?: number
  delivery?: {
    agentIds?: mongoose.Types.ObjectId[]
    pickedUpBy?: mongoose.Types.ObjectId | null
    collectedBy?: mongoose.Types.ObjectId | null
    amountCollectedPaise?: number | null
    dispatchedAt?: Date | null
    closedAt?: Date | null
    deliveredAt?: Date | null
    rto?: { status?: string } | null
  }
  events?: { toStatus?: string; userId?: mongoose.Types.ObjectId; meta?: Record<string, unknown> }[]
}

const LIVE = ['RECEIVED', 'ACCEPTED', 'KOT_PRINTED', 'PREPARED', 'DISPATCHED']
const rupees = (paise: number) => `Rs ${(paise / 100).toFixed(2)}`

function section(title: string, rows: string[]) {
  console.log(`\n${title}: ${rows.length}`)
  for (const r of rows.slice(0, SHOW)) console.log(`  ${r}`)
  if (rows.length > SHOW) console.log(`  ... and ${rows.length - SHOW} more`)
}

/** Who carried an order that predates pickedUpBy, or null when it is unclear. */
function carrierOf(o: Row, riders: Set<string>): mongoose.Types.ObjectId | null {
  const d = o.delivery ?? {}
  const agents = d.agentIds ?? []
  if (d.collectedBy) return d.collectedBy
  if (agents.length === 1) return agents[0]
  // The handover event: a rider's own tap, or a manager naming the rider.
  const out = [...(o.events ?? [])].reverse().find((e) => e.toStatus === 'DISPATCHED')
  const named = out?.meta?.riderId
  if (typeof named === 'string' && mongoose.isValidObjectId(named)) return new mongoose.Types.ObjectId(named)
  if (out?.userId && riders.has(String(out.userId))) return out.userId
  return null
}

async function main() {
  await connectDb()
  const since = new Date(Date.now() - DAYS * 86_400_000)
  console.log(`Rider record audit, orders created in the last ${DAYS} days${APPLY ? ' (will backfill carriers)' : ' (read-only)'}`)

  const riderDocs = await User.find({ role: 'DELIVERY_AGENT' }).select('name restaurantIds').lean()
  const riderName = new Map(riderDocs.map((r) => [String(r._id), r.name]))
  const riderOutlets = new Map(riderDocs.map((r) => [String(r._id), new Set((r.restaurantIds ?? []).map(String))]))
  const riders = new Set(riderName.keys())
  const name = (id: unknown) => riderName.get(String(id)) ?? `unknown user ${String(id)}`

  // scripts/ is outside the lint rule that keeps app code on orderRepo: this
  // is an audit across every outlet, which is exactly what scoping prevents.
  const orders = await Order.find({ createdAt: { $gte: since } })
    .select('externalOrderId status serviceDate restaurantId paymentMode amountPaise delivery events.toStatus events.userId events.meta')
    .lean<Row[]>()
  console.log(`${orders.length} orders read`)

  const label = (o: Row) => `${o.externalOrderId ?? o._id} (${o.serviceDate}, ${o.status})`
  const today = todayIST()

  const rtoDelivered: string[] = []
  const cashDiffers: string[] = []
  const cashUnnamed: string[] = []
  const wrongOutlet: string[] = []
  const offDay: string[] = []
  const ambiguous: string[] = []
  const oddStatus: string[] = []
  const backfill: { _id: mongoose.Types.ObjectId; rider: mongoose.Types.ObjectId }[] = []
  let cashDiffPaise = 0

  for (const o of orders) {
    const d = o.delivery ?? {}
    const agents = d.agentIds ?? []

    if (o.status === 'DELIVERED' && d.rto?.status) {
      rtoDelivered.push(`${label(o)} return is ${d.rto.status}`)
    }

    if (o.status === 'DELIVERED' && o.paymentMode === 'COD') {
      if (d.amountCollectedPaise == null || !d.collectedBy) {
        cashUnnamed.push(`${label(o)} bill ${rupees(o.amountPaise ?? 0)}, ${d.collectedBy ? 'no amount recorded' : 'no holder named'}`)
      } else if (d.amountCollectedPaise !== (o.amountPaise ?? 0)) {
        cashDiffPaise += d.amountCollectedPaise - (o.amountPaise ?? 0)
        cashDiffers.push(
          `${label(o)} bill ${rupees(o.amountPaise ?? 0)}, collected ${rupees(d.amountCollectedPaise)} by ${name(d.collectedBy)}`,
        )
      }
    }

    for (const a of agents) {
      const outlets = riderOutlets.get(String(a))
      if (outlets && !outlets.has(String(o.restaurantId))) {
        wrongOutlet.push(`${label(o)} assigned to ${name(a)}, who is not at this outlet`)
      }
    }

    if (LIVE.includes(o.status) && agents.length > 0 && o.serviceDate !== today) {
      offDay.push(`${label(o)} with ${agents.map(name).join(', ')}`)
    }

    if (!(ORDER_STATUSES as readonly string[]).includes(o.status)) {
      oddStatus.push(label(o))
    }

    const left = Boolean(d.dispatchedAt) || o.status === 'DISPATCHED' || o.status === 'DELIVERED'
    if (left && !d.pickedUpBy && agents.length > 0) {
      const rider = carrierOf(o, riders)
      if (rider) backfill.push({ _id: o._id, rider })
      else {
        ambiguous.push(
          `${label(o)} offered to ${agents.map(name).join(', ')}${d.closedAt ? `, closed on ${opsDayOf(d.closedAt)}` : ''}`,
        )
      }
    }
  }

  section('1. Delivered, but a return is still recorded', rtoDelivered)
  section(`2. COD collected is not the bill (net ${rupees(cashDiffPaise)})`, cashDiffers)
  section('3. COD delivered with no amount or no holder', cashUnnamed)
  section('4. Assigned to a rider from another outlet', wrongOutlet)
  section('5. Live and assigned, but not booked for today', offDay)
  section('6. Several riders, carrier unknown', ambiguous)
  section('7. Status the reports cannot classify', oddStatus)

  console.log(`\nCarrier can be filled in on ${backfill.length} older orders.`)
  if (APPLY && backfill.length > 0) {
    const res = await Order.bulkWrite(
      backfill.map((b) => ({
        updateOne: {
          // Only where still empty: an order picked up while this ran keeps
          // what the app wrote.
          filter: { _id: b._id, 'delivery.pickedUpBy': null },
          update: { $set: { 'delivery.pickedUpBy': b.rider } },
        },
      })),
      { ordered: false },
    )
    console.log(`Wrote the carrier on ${res.modifiedCount}.`)
  } else if (backfill.length > 0) {
    console.log('Run again with --apply to write them. Nothing was changed.')
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => disconnectDb())
