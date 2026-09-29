/**
 * Fills one outlet's kitchen board with today's orders, so the board and the
 * run order table can be looked at with realistic volume and variety rather
 * than one card.
 *
 *   npx tsx --env-file=.env.local scripts/seed-kitchen-board.ts --outlet ANNAPURNA
 *   npx tsx --env-file=.env.local scripts/seed-kitchen-board.ts --outlet ANNAPURNA --set all
 *
 * `--outlet <name>` is required and matched case-insensitively against the
 * outlet name, so it takes a fragment rather than the full registered name.
 * It has no default on purpose: the board shows the signed-in manager's
 * outlets only, and a defaulted outlet silently moves the whole seeded set to
 * a kitchen nobody is looking at.
 *
 * `--set` picks what to write:
 *   core (default)  the ten everyday orders — replaces any existing demo set
 *   edge            five awkward ones, ADDED to whatever is already there
 *   all             core + edge, replacing
 *
 * `edge` never deletes, because its whole job is to supplement a board that
 * already has orders on it.
 *
 * Statuses are spread across the live pipeline through the real
 * transitionOrder(), not written directly, so the per-run status counts and
 * the run-action footer show what they would in production.
 *
 * Card ORDER is not seedable: the board ranks runs by the train feed's live
 * expected arrival, not by anything on the order, and dev with no
 * TRAIN_API_KEY runs the simulator — so expect the cards in the simulator's
 * order, with a past-arrival train possible among them.
 *
 * Idempotent by replacement, sharing the `rawPayload.demo` tag with
 * demo-orders.ts: one demo dataset, so re-running replaces rather than
 * accumulates. `npm run seed:orders` swaps these back for its curated four.
 *
 * Runs against whatever MONGODB_URI .env.local points at (dev, not prod).
 */
import { connectDb, disconnectDb } from '../src/lib/db'
import { Order, Restaurant, User } from '../src/lib/models'
import { createManualOrder } from '../src/lib/repo/createOrder'
import { transitionOrder } from '../src/lib/repo/transitionOrder'
import { ManualOrderInput } from '../src/lib/validation/order'
import { todayIST, utcToIstLocal } from '../src/lib/format'
import type { AuthContext } from '../src/lib/authContext'
import type { OrderStatus } from '../src/lib/orderStatus'

/** The pipeline a store manager walks an order down, in order. */
const PIPELINE: OrderStatus[] = ['ACCEPTED', 'KOT_PRINTED', 'PREPARED']

type Spec = {
  trainNo: string
  trainName: string
  /**
   * Minutes from now, written to the order's `scheduledArrival`.
   *
   * This is NOT what orders the board's cards: the board sorts by the train
   * feed's expected arrival (see timingFor), and with no TRAIN_API_KEY set the
   * feed is the simulator, which invents its own times. So this staggers the
   * order detail and the KOT, not the card order.
   */
  arrivesIn: number
  coach?: string
  berth?: string
  contactName: string
  contactPhone: string
  /** Null is a real case: a COD order nobody priced. The table shouts about it. */
  amountRupees?: string | null
  paymentMode: 'COD' | 'PREPAID' | 'INVOICE'
  /** Where in PIPELINE to leave the order; RECEIVED means untouched. */
  status: OrderStatus
  items?: { name: string; qty: number; priceRupees?: string; isPacking?: boolean }[]
  /** Present for a bulk order, which takes a composite menu instead of items. */
  bulk?: { pax: number; menuSpec: string; handoverPoint: string; packingItems: string[] }
  notes?: string
  /**
   * Written after creation, because the manual-entry form has no field for
   * it — only an aggregator parser produces a raw seat string. Clears
   * coach/berth so the table renders the fallback rather than the chip.
   */
  rawSeat?: string
  /** Pushed onto callLog after creation, oldest first. */
  callNotes?: string[]
  /** Backdates createdAt, so the Placed column is not ten identical times. */
  placedMinutesAgo?: number
}

/**
 * The everyday board: four trains, ten orders, statuses across the pipeline.
 *
 * Item lists deliberately cover every branch a board row has to render: qty 1
 * (no "×1" suffix), qty > 1, several food lines on one row, and packing lines
 * that must NOT appear on the board at all.
 */
const CORE: Spec[] = [
  {
    trainNo: '12506', trainName: 'NORTH EAST EXP', arrivesIn: 35,
    coach: 'B5', berth: '37', contactName: 'Neelesh Soni', contactPhone: '9752446747',
    amountRupees: '150', paymentMode: 'COD', status: 'PREPARED', placedMinutesAgo: 95,
    items: [{ name: 'Veg Thali', qty: 1, priceRupees: '150' }],
  },
  {
    trainNo: '12506', trainName: 'NORTH EAST EXP', arrivesIn: 35,
    coach: 'S3', berth: '45', contactName: 'Anita Verma', contactPhone: '9839044444',
    amountRupees: '440', paymentMode: 'PREPAID', status: 'KOT_PRINTED', placedMinutesAgo: 88,
    items: [
      { name: 'Chicken Biryani', qty: 2, priceRupees: '220' },
      { name: 'Tissue', qty: 2, isPacking: true },
    ],
  },
  {
    trainNo: '12506', trainName: 'NORTH EAST EXP', arrivesIn: 35,
    coach: 'A1', berth: '12', contactName: 'Rakesh Tiwari', contactPhone: '9839055555',
    amountRupees: '296', paymentMode: 'COD', status: 'RECEIVED', placedMinutesAgo: 12,
    items: [
      { name: 'Paneer Paratha With Curd Combo', qty: 1, priceRupees: '236' },
      { name: 'Masala Chai', qty: 2, priceRupees: '30' },
    ],
    notes: 'Less spicy, child travelling',
  },
  {
    trainNo: '12522', trainName: 'RAPTISAGAR EXP', arrivesIn: 80,
    coach: 'S2', berth: '23', contactName: 'Manoj Singh', contactPhone: '8807411138',
    amountRupees: '600', paymentMode: 'COD', status: 'ACCEPTED', placedMinutesAgo: 64,
    items: [
      { name: 'Veg Mini Thali', qty: 4, priceRupees: '150' },
      { name: 'Spoon', qty: 4, isPacking: true },
      { name: 'Tissue', qty: 4, isPacking: true },
    ],
  },
  {
    trainNo: '12522', trainName: 'RAPTISAGAR EXP', arrivesIn: 80,
    coach: 'B1', berth: '8', contactName: 'Sunita Rao', contactPhone: '9839077777',
    amountRupees: '213', paymentMode: 'PREPAID', status: 'ACCEPTED', placedMinutesAgo: 57,
    items: [{ name: 'Amritsari Thali', qty: 1, priceRupees: '213' }],
  },
  {
    trainNo: '12522', trainName: 'RAPTISAGAR EXP', arrivesIn: 80,
    coach: 'S6', berth: '11', contactName: 'Vivek Nair', contactPhone: '8075771877',
    amountRupees: '237', paymentMode: 'COD', status: 'RECEIVED', placedMinutesAgo: 9,
    items: [
      { name: 'Chicken Curry With Roti Combo', qty: 1, priceRupees: '197' },
      { name: 'Lassi', qty: 1, priceRupees: '40' },
    ],
  },
  {
    trainNo: '12323', trainName: 'HWH BME EXP', arrivesIn: 150,
    coach: 'B5', berth: '66', contactName: 'Abhishek Vaisnav', contactPhone: '7984434724',
    amountRupees: '681', paymentMode: 'COD', status: 'KOT_PRINTED', placedMinutesAgo: 73,
    items: [{ name: 'Veg Deluxe Thali', qty: 3, priceRupees: '227' }],
  },
  {
    trainNo: '12323', trainName: 'HWH BME EXP', arrivesIn: 150,
    coach: 'S1', berth: '73', contactName: 'Arnav Agarwal', contactPhone: '9044584440',
    amountRupees: '410', paymentMode: 'PREPAID', status: 'RECEIVED', placedMinutesAgo: 6,
    items: [
      { name: 'Aloo Paratha With Chole Combo', qty: 2, priceRupees: '175' },
      { name: 'Curd', qty: 2, priceRupees: '30' },
      { name: 'Water bottle 500ml', qty: 2, isPacking: true },
    ],
  },
  {
    trainNo: '12310', trainName: 'RJPB TEJAS RAJ', arrivesIn: 215,
    coach: 'H1', berth: '9', contactName: 'Rupesh Kumar', contactPhone: '7858095122',
    amountRupees: '190', paymentMode: 'PREPAID', status: 'RECEIVED', placedMinutesAgo: 30,
    items: [{ name: 'Egg Curry Rice', qty: 1, priceRupees: '190' }],
  },
  {
    trainNo: '12310', trainName: 'RJPB TEJAS RAJ', arrivesIn: 215,
    coach: 'A2', berth: '31', contactName: 'Farida Sheikh', contactPhone: '9839088888',
    amountRupees: '540', paymentMode: 'COD', status: 'RECEIVED', placedMinutesAgo: 3,
    items: [
      { name: 'Veg Biryani With Raita Combo', qty: 2, priceRupees: '210' },
      { name: 'Gulab Jamun', qty: 4, priceRupees: '30' },
    ],
    notes: 'Call on arrival, deaf passenger',
  },
]

/**
 * The awkward ones. Each exists to light up a branch of RunOrderTable that a
 * board of ordinary retail orders never reaches: the bulk handover, the COD
 * order with no amount, the raw seat string, the call-note hint, and a row
 * long enough to truncate.
 */
const EDGE: Spec[] = [
  {
    // Bulk: "60 pax thali" in the items cell, a Handover chip in place of the
    // coach chip, and the INVOICE payment badge.
    trainNo: '12554', trainName: 'VAISHALI EXP', arrivesIn: 120,
    contactName: 'Mr Yadav (group)', contactPhone: '9839066666',
    amountRupees: '15000', paymentMode: 'INVOICE', status: 'ACCEPTED', placedMinutesAgo: 140,
    bulk: {
      pax: 60,
      menuSpec:
        '2pcs Egg Curry + Dry Aloo Jeera + Dal Fry + Jeera Rice + 3 Butter Roti\n' +
        'Sweet (Gulab Jamun) + Salad + Pickle',
      handoverPoint: 'coach B3 door, contact Mr Yadav on arrival',
      packingItems: ['Water bottle 500ml', 'Tissue', 'Spoon'],
    },
  },
  {
    // COD with nothing to collect against — the row turns this red rather
    // than printing a quiet dash.
    trainNo: '12554', trainName: 'VAISHALI EXP', arrivesIn: 120,
    coach: 'S5', berth: '14', contactName: 'Imran Qureshi', contactPhone: '9839099999',
    amountRupees: null, paymentMode: 'COD', status: 'RECEIVED', placedMinutesAgo: 4,
    items: [{ name: 'Chole Bhature', qty: 1 }],
  },
  {
    // No coach/berth, just the raw string an aggregator sent — the seat cell
    // falls back to it.
    trainNo: '12323', trainName: 'HWH BME EXP', arrivesIn: 150,
    contactName: 'Priya Balan', contactPhone: '9500011122',
    amountRupees: '360', paymentMode: 'PREPAID', status: 'ACCEPTED', placedMinutesAgo: 51,
    rawSeat: 'RAC/S4/23-24',
    items: [{ name: 'Veg Deluxe Thali', qty: 2, priceRupees: '180' }],
  },
  {
    // Three call notes: the row shows the hint badge, and the tooltip lists
    // the most recent three newest-first.
    trainNo: '12506', trainName: 'NORTH EAST EXP', arrivesIn: 35,
    coach: 'B2', berth: '19', contactName: 'Devendra Joshi', contactPhone: '9839012121',
    amountRupees: '275', paymentMode: 'COD', status: 'RECEIVED', placedMinutesAgo: 41,
    items: [{ name: 'Rajma Chawal', qty: 1, priceRupees: '175' }, { name: 'Boondi Raita', qty: 1, priceRupees: '100' }],
    callNotes: [
      'Passenger called, asked to confirm the train is running late',
      'Called back — wants delivery at the coach door, not the window',
      'Says he is in the pantry side; will wave from B2',
    ],
  },
  {
    // Long enough to truncate in the passenger cell, and four food lines so
    // the items cell shows its "+3" overflow badge.
    trainNo: '12310', trainName: 'RJPB TEJAS RAJ', arrivesIn: 215,
    coach: 'A3', berth: '55', contactName: 'Lakshminarayanan Venkataraghavan', contactPhone: '9500033344',
    amountRupees: '905', paymentMode: 'PREPAID', status: 'RECEIVED', placedMinutesAgo: 2,
    items: [
      { name: 'Paneer Butter Masala With Butter Naan Combo', qty: 2, priceRupees: '285' },
      { name: 'Veg Fried Rice', qty: 1, priceRupees: '160' },
      { name: 'Masala Papad', qty: 3, priceRupees: '45' },
      { name: 'Gulab Jamun', qty: 2, priceRupees: '20' },
      { name: 'Tissue', qty: 4, isPacking: true },
    ],
  },
]

function arg(flag: string): string {
  const i = process.argv.indexOf(flag)
  return i === -1 ? '' : (process.argv[i + 1] ?? '').trim()
}

async function main() {
  await connectDb()

  const wanted = arg('--outlet')
  if (!wanted) {
    const all = await Restaurant.find({ active: true }).select('name stationCode').sort({ name: 1 }).lean()
    throw new Error(
      '--outlet is required (no default: a wrong kitchen looks like an empty board).\n' +
        `Active outlets: ${all.map((o) => `${o.name} @${o.stationCode}`).join(', ')}`,
    )
  }

  const set = (arg('--set') || 'core').toLowerCase()
  if (!['core', 'edge', 'all'].includes(set)) throw new Error(`--set must be core, edge or all (got "${set}")`)
  const specs = set === 'core' ? CORE : set === 'edge' ? EDGE : [...CORE, ...EDGE]

  const admin = await User.findOne({ role: 'ADMIN' })
  if (!admin) throw new Error('No admin user. Run `npm run seed` first.')
  const ctx: AuthContext = { userId: admin._id, role: 'ADMIN', restaurantIds: [] }

  // Escaped, not interpolated raw: an outlet name is data here, and a stray
  // regex metacharacter should not silently match a different kitchen.
  const pattern = new RegExp(wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  const matches = await Restaurant.find({ name: pattern }).select('name stationCode')
  if (matches.length === 0) throw new Error(`No outlet matching "${wanted}".`)
  if (matches.length > 1) {
    throw new Error(`"${wanted}" matches ${matches.length} outlets: ${matches.map((m) => m.name).join(', ')}. Narrow it.`)
  }
  const outlet = matches[0]

  // `edge` supplements a board rather than defining one, so it never clears.
  if (set !== 'edge') {
    const removed = await Order.deleteMany({ 'rawPayload.demo': true })
    if (removed.deletedCount) console.log(`Replaced ${removed.deletedCount} previous demo order(s).\n`)
  }

  const today = todayIST()
  // Relative to now, not a clock time, so the leave-now countdown and the
  // delay guard mean something whenever this is run.
  const inMinutes = (m: number) => utcToIstLocal(new Date(Date.now() + m * 60_000))

  for (const s of specs) {
    const order = await createManualOrder(
      ctx,
      ManualOrderInput.parse({
        orderType: s.bulk ? 'BULK' : 'RETAIL',
        restaurantId: String(outlet._id),
        serviceDate: today,
        trainNo: s.trainNo,
        trainName: s.trainName,
        scheduledArrival: inMinutes(s.arrivesIn),
        coach: s.coach ?? null,
        berth: s.berth ?? null,
        contactName: s.contactName,
        contactPhone: s.contactPhone,
        amountRupees: s.amountRupees ?? null,
        paymentMode: s.paymentMode,
        notes: s.notes ?? null,
        ...(s.bulk
          ? {
              pax: s.bulk.pax,
              menuSpec: s.bulk.menuSpec,
              handoverPoint: s.bulk.handoverPoint,
              packingItems: s.bulk.packingItems,
              readyBy: inMinutes(s.arrivesIn - 60),
              items: [],
            }
          : {
              items: (s.items ?? []).map((i) => ({
                name: i.name,
                qty: i.qty,
                priceRupees: i.priceRupees ?? '',
                isPacking: i.isPacking ?? false,
              })),
            }),
      }),
    )

    // Tag before transitioning: a failed transition still leaves a replaceable
    // order behind rather than one the next run cannot clean up.
    await Order.updateOne({ _id: order._id }, { $set: { rawPayload: { demo: true } } })

    const upto = PIPELINE.indexOf(s.status)
    for (const to of PIPELINE.slice(0, upto + 1)) {
      await transitionOrder({ ctx, orderId: String(order._id), to })
    }

    // Everything the manual-entry form cannot express, written last so the
    // transitions above cannot overwrite it.
    const patch: Record<string, unknown> = {}
    if (s.rawSeat) Object.assign(patch, { rawSeat: s.rawSeat, coach: null, berth: null })
    if (s.callNotes?.length) {
      patch.callLog = s.callNotes.map((text, n) => ({
        text,
        userId: admin._id,
        // Spread backwards from now so the newest-first tooltip has an order.
        createdAt: new Date(Date.now() - (s.callNotes!.length - n) * 7 * 60_000),
      }))
    }
    if (Object.keys(patch).length) await Order.updateOne({ _id: order._id }, { $set: patch })

    // createdAt goes through the raw driver, not the model: Mongoose marks a
    // timestamps-managed createdAt immutable and strips it from $set without
    // erroring, so a model updateOne here leaves every order stamped with the
    // moment this script ran and the board's Placed column reads identically
    // down the page.
    if (s.placedMinutesAgo) {
      await Order.collection.updateOne(
        { _id: order._id },
        { $set: { createdAt: new Date(Date.now() - s.placedMinutesAgo * 60_000) } },
      )
    }

    const what = s.bulk ? `${s.bulk.pax} pax thali` : `${(s.items ?? []).filter((i) => !i.isPacking).length} food line(s)`
    console.log(
      `  ✓ ${order.externalOrderId}  ${s.trainNo} ${s.trainName.padEnd(16)} ` +
        `${s.status.padEnd(11)} ${what}`,
    )
  }

  const managers = await User.find({ role: 'STORE_MANAGER', active: true, restaurantIds: outlet._id })
    .select('name phone')
    .lean()
  console.log(`\n${specs.length} order(s) [--set ${set}] on ${outlet.name} (@${outlet.stationCode}).`)
  console.log(
    managers.length
      ? `Visible at /store to: ${managers.map((m) => `${m.name} (${m.phone})`).join(', ')}`
      : 'No active store manager holds this outlet — only an ADMIN login will see these.',
  )
  await disconnectDb()
}

main().catch((err) => {
  console.error('\nKitchen board seed FAILED:', err.message)
  process.exit(1)
})
