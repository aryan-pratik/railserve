/**
 * Fills every section of the v2 UI with demo data, on the DEV database only.
 *
 *   npm run seed:v2
 *
 * Refuses to run unless MONGODB_URI names `railserve_dev`. Idempotent by
 * replacement: everything it writes is tagged — orders `rawPayload.demoV2`,
 * payments `rawPayload.demoV2` + a `[demo-v2]` remark prefix, unparsed inbox
 * rows `rawPayload.demoV2`, WhatsApp threads on numbers 9000099xxx — and the
 * previous run's records are deleted before the new ones are written. Nothing
 * else is touched, with one documented exception: the RiderLocation rows of
 * the three CNB riders it positions (ephemeral position data on dev).
 *
 * Status changes go through the real repo functions (transitionOrder,
 * assignAgents, requestCancellation, markReturnedToOrigin, settleRiderCash,
 * flagRatingOrder, appendCallNote, setKotNote, recordInbound, recordPayment)
 * so events, RTO and COD fields are what production would write. Direct model
 * writes are used only where no repo path exists: backdating last week's
 * orders, outbound chat lines (the simulator would answer them), the unparsed
 * inbox and payment remarks.
 */
import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import { connectDb, disconnectDb } from '../src/lib/db'
import {
  MenuItem,
  Order,
  Payment,
  Restaurant,
  RiderLocation,
  UnparsedInbox,
  User,
  WaConversation,
  WaMessage,
  type OrderDoc,
  type UserDoc,
} from '../src/lib/models'
import { createManualOrder } from '../src/lib/repo/createOrder'
import { createEnquiry } from '../src/lib/repo/createEnquiry'
import { assignAgents, flagRatingOrder, transitionOrder } from '../src/lib/repo/transitionOrder'
import { requestCancellation } from '../src/lib/repo/cancelRequestRepo'
import { markReturnedToOrigin } from '../src/lib/repo/rtoRepo'
import { settleRiderCash } from '../src/lib/repo/riderCashRepo'
import { appendCallNote, setKotNote } from '../src/lib/repo/orderRepo'
import { recordFixes } from '../src/lib/repo/riderLocationRepo'
import { assignConversation, markRead, recordInbound } from '../src/lib/repo/whatsappRepo'
import { recordPayment, SlicePaymentParser } from '../src/lib/ingest/payments'
import { ManualOrderInput } from '../src/lib/validation/order'
import { istLocalToUtc, shiftServiceDate, todayIST, utcToIstLocal } from '../src/lib/format'
import type { AuthContext } from '../src/lib/authContext'
import type { OrderStatus } from '../src/lib/orderStatus'

/* ── tags ─────────────────────────────────────────────────────────────────── */

const TAG = { demoV2: true } as const
const PAY_PREFIX = '[demo-v2]'
const WA_PREFIX = '919000099' // every demo WhatsApp number is 91 9000099xxx

/* ── small helpers ────────────────────────────────────────────────────────── */

const MIN = 60_000
const HOUR = 60 * MIN
const now = new Date()
const today = todayIST(now)

/** IST local string this many minutes from now. */
const inMinutes = (m: number) => utcToIstLocal(new Date(now.getTime() + m * MIN))

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

function ctxOf(u: UserDoc): AuthContext {
  return { userId: u._id, role: u.role, restaurantIds: u.restaurantIds }
}

/* ── reference data ───────────────────────────────────────────────────────── */

type OutletKey = 'GG' | 'CZ' | 'AN' | 'BS' | 'KK'

const OUTLET_NAMES: Record<OutletKey, string> = {
  GG: 'HOTEL GANGA GALAXY',
  CZ: 'THE COSMOZIN LOUNGE',
  AN: 'SHREE ANNAPURNA BHOJNALAYA',
  BS: 'BITE STATION GAYA',
  KK: 'KHANA KHAZANA',
}

type Train = { no: string; name: string; arriveIn: number }

/** Six trains per station, arrivals from an hour ago to eight hours ahead. */
const TRAINS: Record<'CNB' | 'PRYJ' | 'GAYA', Train[]> = {
  CNB: [
    { no: '12506', name: 'NORTH EAST EXP', arriveIn: -50 },
    { no: '12312', name: 'KALKA MAIL', arriveIn: 25 },
    { no: '12310', name: 'RJPB TEJAS RAJ', arriveIn: 70 },
    { no: '12554', name: 'VAISHALI EXP', arriveIn: 150 },
    { no: '12801', name: 'PURUSHOTTAM EXP', arriveIn: 260 },
    { no: '15631', name: 'BME GHY EXPRESS', arriveIn: 440 },
  ],
  PRYJ: [
    { no: '12303', name: 'POORVA EXPRESS', arriveIn: -30 },
    { no: '12802', name: 'PURUSHOTTAM EXP', arriveIn: 45 },
    { no: '12424', name: 'DBRT RAJDHANI', arriveIn: 110 },
    { no: '12488', name: 'SEEMANCHAL EXP', arriveIn: 200 },
    { no: '13008', name: 'U A TOOFAN EXP', arriveIn: 330 },
    { no: '12382', name: 'POORVA EXPRESS', arriveIn: 470 },
  ],
  GAYA: [
    { no: '12302', name: 'HWH RAJDHANI', arriveIn: -40 },
    { no: '12398', name: 'MAHABODHI EXP', arriveIn: 35 },
    { no: '13010', name: 'DOON EXPRESS', arriveIn: 95 },
    { no: '12988', name: 'AII SDAH EXP', arriveIn: 180 },
    { no: '12352', name: 'RJPB HWH EXP', arriveIn: 300 },
    { no: '12818', name: 'JHARKHAND SJ EXP', arriveIn: 420 },
  ],
}

const NAMES: [string, string][] = [
  ['Neelesh Soni', '9752446747'], ['Anita Verma', '9839044444'], ['Rakesh Tiwari', '9901213344'],
  ['Sneha Patel', '9555533221'], ['Amit Kumar', '9876543210'], ['Priya Nair', '9812345678'],
  ['Vikram Singh', '9700011122'], ['Fatima Sheikh', '9822233344'], ['Deepak Yadav', '9911122233'],
  ['Meera Joshi', '9765432109'], ['Arjun Reddy', '9988776655'], ['Kavita Rao', '9871122334'],
  ['Sanjay Gupta', '9099887766'], ['Rhea D Souza', '9822119900'], ['Imran Qureshi', '9733445566'],
  ['Lakshmi Iyer', '9844556677'], ['Harpreet Kaur', '9955667788'], ['Tarun Bose', '9066778899'],
  ['Nisha Agarwal', '9177889900'], ['Vivek Menon', '9288990011'], ['Sunita Devi', '9399001122'],
  ['Rohit Chauhan', '9400112233'], ['Ayesha Khan', '9511223344'], ['Gopal Mishra', '9622334455'],
  ['Pooja Bhatt', '9733445577'], ['Zubair Ahmed', '9844556688'], ['Manish Dubey', '9935012345'],
  ['Shalini Pandey', '9415098765'], ['Abhishek Jha', '9430011223'], ['Ritu Saxena', '9450022334'],
  ['Farhan Ali', '9470033445'], ['Divya Tripathi', '9490044556'], ['Kunal Shah', '9510055667'],
  ['Geeta Kumari', '9530066778'], ['Prakash Rao', '9550077889'], ['Swati Mishra', '9570088990'],
  ['Naveen Pillai', '9590099001'], ['Bhavna Thakur', '9610000112'], ['Yusuf Khan', '9630011223'],
  ['Alok Srivastava', '9650022334'], ['Megha Kulkarni', '9670033445'], ['Sandeep Rathi', '9690044556'],
  ['Preeti Sinha', '9710055667'], ['Rajeev Ranjan', '9730066778'], ['Komal Verma', '9750077889'],
]
const COACHES = ['B1', 'B2', 'B3', 'A1', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'B4', 'B5', 'A2', 'S7', 'M1', 'M2']

/* ── menu ─────────────────────────────────────────────────────────────────── */

type Dish = { name: string; price: number; diet: 'VEG' | 'NON_VEG' }

async function loadMenu(): Promise<{ veg: Dish[]; nonVeg: Dish[] }> {
  const rows = await MenuItem.find({ removedAt: null, diet: { $ne: null } }).select('name diet').lean()
  const seen = new Set<string>()
  const veg: Dish[] = []
  const nonVeg: Dish[] = []
  for (const r of rows) {
    const key = r.name.trim().toLowerCase()
    if (seen.has(key) || r.name.length > 45) continue
    seen.add(key)
    const base = 150 + (hash(r.name) % 18) * 10
    if (r.diet === 'VEG') veg.push({ name: r.name.trim(), price: base, diet: 'VEG' })
    else if (r.diet === 'NON_VEG') nonVeg.push({ name: r.name.trim(), price: base + 90, diet: 'NON_VEG' })
  }
  if (veg.length < 6 || nonVeg.length < 3) {
    throw new Error(`Menu too thin for a demo (veg ${veg.length}, non-veg ${nonVeg.length}). Run npm run menu:seed.`)
  }
  return { veg, nonVeg }
}

type Mix = 'VEG' | 'NON_VEG' | 'MIX'

function pickItems(menu: { veg: Dish[]; nonVeg: Dish[] }, mix: Mix, seed: number) {
  const vegA = menu.veg[seed % menu.veg.length]
  const vegB = menu.veg[(seed * 7 + 3) % menu.veg.length]
  const nv = menu.nonVeg[seed % menu.nonVeg.length]
  const picked: Dish[] =
    mix === 'VEG' ? (seed % 2 ? [vegA, vegB] : [vegA])
    : mix === 'NON_VEG' ? [nv]
    : [nv, vegA]
  const items = picked.map((d, i) => ({
    name: d.name, qty: i === 0 && seed % 3 === 0 ? 2 : 1, priceRupees: String(d.price), isPacking: false,
  }))
  if (seed % 4 === 0) items.push({ name: 'Mineral water 500ml', qty: 1, priceRupees: '20', isPacking: true })
  const amount = items.reduce((s, i) => s + Number(i.priceRupees) * i.qty, 0)
  return { items, amount }
}

/* ── the plan for today ───────────────────────────────────────────────────── */

type Flow =
  | 'RECEIVED' | 'ACCEPTED' | 'KOT_PRINTED' | 'PREPARED' | 'PREPARED_ASSIGNED'
  | 'DISPATCHED' | 'DELIVERED' | 'DELIVERED_SETTLED'
  | 'FAILED_RTO' | 'FAILED_RETURNED' | 'CANCELLED' | 'CANCELLED_ON_WAY'
  | 'MISSED' | 'RATING' | 'CANCEL_REQ'

type RiderKey = 'ravi' | 'suresh' | 'sandeep' | 'sanjeet'

type Spec = {
  outlet: OutletKey
  train: number
  flow: Flow
  pay: 'COD' | 'PREPAID'
  mix: Mix
  rider?: RiderKey
  callNotes?: string[]
  kotNote?: string
  reason?: string
  /** Fixed contact, used where a chat thread must link to this order. */
  contact?: [string, string]
}

const TODAY: Spec[] = [
  // Ganga Galaxy, CNB — the busiest board, riders Ravi / sandeep / sanjeet
  { outlet: 'GG', train: 0, flow: 'DELIVERED', pay: 'COD', mix: 'VEG', rider: 'ravi' },
  { outlet: 'GG', train: 0, flow: 'DELIVERED', pay: 'PREPAID', mix: 'NON_VEG', rider: 'sandeep' },
  { outlet: 'GG', train: 0, flow: 'FAILED_RTO', pay: 'COD', mix: 'MIX', rider: 'ravi',
    reason: 'Passenger not on berth, phone switched off',
    callNotes: ['Called twice, no answer. Rider waited till departure.'] },
  { outlet: 'GG', train: 0, flow: 'DELIVERED_SETTLED', pay: 'COD', mix: 'VEG', rider: 'ravi' },
  { outlet: 'GG', train: 1, flow: 'DISPATCHED', pay: 'COD', mix: 'VEG', rider: 'ravi' },
  { outlet: 'GG', train: 1, flow: 'DISPATCHED', pay: 'PREPAID', mix: 'MIX', rider: 'sanjeet',
    kotNote: 'No onion, extra pickle' },
  { outlet: 'GG', train: 1, flow: 'PREPARED_ASSIGNED', pay: 'COD', mix: 'NON_VEG', rider: 'ravi' },
  { outlet: 'GG', train: 1, flow: 'MISSED', pay: 'COD', mix: 'VEG', rider: 'sandeep',
    callNotes: ['Train left from PF 4 instead of PF 1. Rider could not reach the coach in time.'] },
  { outlet: 'GG', train: 2, flow: 'CANCEL_REQ', pay: 'COD', mix: 'VEG',
    reason: 'Passenger called the counter: boarded a different train, will not be at CNB.' },
  { outlet: 'GG', train: 2, flow: 'ACCEPTED', pay: 'PREPAID', mix: 'MIX', contact: ['Neha Srivastava', '9000099001'],
    callNotes: ['Confirmed order on call. Wants delivery at the coach door, not the berth.',
      'Asked for a spoon and extra tissue.'] },
  { outlet: 'GG', train: 2, flow: 'RECEIVED', pay: 'COD', mix: 'VEG' },
  { outlet: 'GG', train: 3, flow: 'RATING', pay: 'PREPAID', mix: 'VEG' },
  { outlet: 'GG', train: 3, flow: 'RECEIVED', pay: 'PREPAID', mix: 'VEG', kotNote: 'Jain: no onion, no garlic' },
  { outlet: 'GG', train: 3, flow: 'CANCELLED_ON_WAY', pay: 'COD', mix: 'NON_VEG', rider: 'sandeep',
    reason: 'Train diverted via Lucknow after dispatch' },
  { outlet: 'GG', train: 4, flow: 'ACCEPTED', pay: 'COD', mix: 'MIX' },
  { outlet: 'GG', train: 5, flow: 'RECEIVED', pay: 'COD', mix: 'VEG' },
  // Cosmozin Lounge, CNB — riders sandeep / sanjeet
  { outlet: 'CZ', train: 0, flow: 'DELIVERED', pay: 'COD', mix: 'NON_VEG', rider: 'sandeep' },
  { outlet: 'CZ', train: 1, flow: 'PREPARED', pay: 'PREPAID', mix: 'VEG' },
  { outlet: 'CZ', train: 2, flow: 'DISPATCHED', pay: 'COD', mix: 'MIX', rider: 'sanjeet' },
  { outlet: 'CZ', train: 3, flow: 'KOT_PRINTED', pay: 'COD', mix: 'VEG' },
  { outlet: 'CZ', train: 4, flow: 'RECEIVED', pay: 'PREPAID', mix: 'NON_VEG' },
  // Annapurna, PRYJ — rider Suresh
  { outlet: 'AN', train: 0, flow: 'DELIVERED', pay: 'COD', mix: 'VEG', rider: 'suresh' },
  { outlet: 'AN', train: 0, flow: 'FAILED_RETURNED', pay: 'PREPAID', mix: 'VEG', rider: 'suresh',
    reason: 'Coach S4 was detached at PRYJ; passenger in the rear portion' },
  { outlet: 'AN', train: 1, flow: 'DISPATCHED', pay: 'COD', mix: 'MIX', rider: 'suresh' },
  { outlet: 'AN', train: 1, flow: 'PREPARED_ASSIGNED', pay: 'PREPAID', mix: 'VEG', rider: 'suresh' },
  { outlet: 'AN', train: 2, flow: 'CANCEL_REQ', pay: 'COD', mix: 'NON_VEG',
    reason: 'Kitchen is out of chicken tonight and the passenger refused a veg substitute.' },
  { outlet: 'AN', train: 2, flow: 'CANCELLED', pay: 'PREPAID', mix: 'VEG', reason: 'Duplicate of an aggregator order' },
  { outlet: 'AN', train: 3, flow: 'KOT_PRINTED', pay: 'COD', mix: 'VEG', kotNote: 'Less spicy, child meal' },
  { outlet: 'AN', train: 4, flow: 'RECEIVED', pay: 'COD', mix: 'MIX' },
  // Bite Station, GAYA — no riders at this station, so the kitchen states only
  { outlet: 'BS', train: 1, flow: 'PREPARED', pay: 'COD', mix: 'VEG' },
  { outlet: 'BS', train: 2, flow: 'KOT_PRINTED', pay: 'PREPAID', mix: 'NON_VEG' },
  { outlet: 'BS', train: 3, flow: 'ACCEPTED', pay: 'COD', mix: 'VEG' },
  { outlet: 'BS', train: 5, flow: 'RECEIVED', pay: 'COD', mix: 'MIX' },
  // Khana Khazana, GAYA
  { outlet: 'KK', train: 0, flow: 'CANCELLED', pay: 'COD', mix: 'VEG', reason: 'Passenger cancelled before the kitchen started' },
  { outlet: 'KK', train: 2, flow: 'RECEIVED', pay: 'PREPAID', mix: 'NON_VEG' },
  { outlet: 'KK', train: 4, flow: 'ACCEPTED', pay: 'COD', mix: 'VEG',
    callNotes: ['Passenger asked whether the thali has curd. Told yes.'] },
]

/** Last week: three closed orders a day. */
type PastSpec = { outlet: OutletKey; flow: 'DELIVERED' | 'FAILED_RTO' | 'CANCELLED'; pay: 'COD' | 'PREPAID'; rider?: RiderKey; hour: number }
const PAST_PATTERN: PastSpec[][] = [
  [{ outlet: 'GG', flow: 'DELIVERED', pay: 'COD', rider: 'ravi', hour: 12 },
   { outlet: 'AN', flow: 'DELIVERED', pay: 'PREPAID', rider: 'suresh', hour: 19 },
   { outlet: 'GG', flow: 'FAILED_RTO', pay: 'COD', rider: 'sandeep', hour: 21 }],
  [{ outlet: 'GG', flow: 'DELIVERED', pay: 'COD', rider: 'sanjeet', hour: 13 },
   { outlet: 'CZ', flow: 'CANCELLED', pay: 'PREPAID', hour: 17 },
   { outlet: 'AN', flow: 'DELIVERED', pay: 'COD', rider: 'suresh', hour: 20 }],
  [{ outlet: 'GG', flow: 'DELIVERED', pay: 'PREPAID', rider: 'ravi', hour: 9 },
   { outlet: 'BS', flow: 'CANCELLED', pay: 'COD', hour: 14 },
   { outlet: 'CZ', flow: 'DELIVERED', pay: 'COD', rider: 'sandeep', hour: 22 }],
]

/* ── main ─────────────────────────────────────────────────────────────────── */

async function main() {
  const uri = process.env.MONGODB_URI ?? ''
  if (!uri.includes('railserve_dev')) {
    throw new Error('Refusing to run: MONGODB_URI must point at the railserve_dev database.')
  }
  await connectDb()

  /* actors */
  const byPhone = async (phone: string, what: string) => {
    const u = await User.findOne({ phone, active: true })
    if (!u) throw new Error(`Missing ${what} (${phone}). Run npm run seed / seed:rider first.`)
    return u
  }
  const admin = await byPhone('9000000001', 'admin')
  const manager = await byPhone('9000000006', 'store manager')
  const telecaller = await byPhone('9000000777', 'telecaller')
  const riders: Record<RiderKey, UserDoc> = {
    ravi: await byPhone('9000000004', 'rider Ravi Kumar'),
    suresh: await byPhone('9000000005', 'rider Suresh Yadav'),
    sandeep: await byPhone('9580724427', 'rider sandeep'),
    sanjeet: await byPhone('9217192624', 'rider sanjeet'),
  }
  const adminCtx = ctxOf(admin)
  const managerCtx = ctxOf(manager)
  const telecallerCtx = ctxOf(telecaller)
  const riderCtx = (k: RiderKey) => ctxOf(riders[k])

  /* outlets */
  const outlets = {} as Record<OutletKey, { _id: mongoose.Types.ObjectId; stationCode: 'CNB' | 'PRYJ' | 'GAYA'; name: string }>
  for (const [key, name] of Object.entries(OUTLET_NAMES) as [OutletKey, string][]) {
    const r = await Restaurant.findOne({ name, active: true }).lean()
    if (!r) throw new Error(`Outlet "${name}" is missing or inactive on this database.`)
    outlets[key] = { _id: r._id, stationCode: r.stationCode as 'CNB' | 'PRYJ' | 'GAYA', name: r.name }
  }
  const holds = (u: UserDoc, key: OutletKey) => u.restaurantIds.some((id) => id.equals(outlets[key]._id))
  /** Who walks the kitchen steps: the store manager where she holds the outlet, else the admin. */
  const kitchenCtx = (key: OutletKey) => (holds(manager, key) ? managerCtx : adminCtx)
  /** Who writes call notes: the telecaller where he holds the outlet, else the admin. */
  const noteCtx = (key: OutletKey) => (holds(telecaller, key) ? telecallerCtx : adminCtx)

  /* ── 1. remove the previous run ───────────────────────────────────────── */
  const prevOrders = await Order.find({ 'rawPayload.demoV2': true }).select('_id').lean()
  const prevOrderIds = prevOrders.map((o) => o._id)
  const removed = {
    orders: (await Order.deleteMany({ _id: { $in: prevOrderIds } })).deletedCount,
    payments: (await Payment.deleteMany({ $or: [{ 'rawPayload.demoV2': true }, { remark: new RegExp(`^\\${PAY_PREFIX}`) }] })).deletedCount,
    inbox: (await UnparsedInbox.deleteMany({ 'rawPayload.demoV2': true })).deletedCount,
    chats: 0,
    messages: 0,
  }
  const prevConvs = await WaConversation.find({ phone: new RegExp(`^${WA_PREFIX}`) }).select('_id').lean()
  const prevConvIds = prevConvs.map((c) => c._id)
  removed.messages = (await WaMessage.deleteMany({ conversationId: { $in: prevConvIds } })).deletedCount
  removed.chats = (await WaConversation.deleteMany({ _id: { $in: prevConvIds } })).deletedCount
  // Position rows are ephemeral and only move forward in time; clearing them is
  // what lets the trail below start clean on a re-run the same day.
  await RiderLocation.deleteMany({ userId: { $in: [riders.ravi._id, riders.sandeep._id, riders.sanjeet._id] } })
  console.log(
    `cleared : ${removed.orders} orders, ${removed.payments} payments, ${removed.inbox} inbox rows, ` +
    `${removed.chats} chats (${removed.messages} messages)`,
  )

  const menu = await loadMenu()

  /* ── 2. orders ────────────────────────────────────────────────────────── */

  const tag = (id: mongoose.Types.ObjectId, extra: Record<string, unknown> = {}) =>
    Order.updateOne({ _id: id }, { $set: { rawPayload: { ...TAG, ...extra } } }, { timestamps: false })

  let seq = 0
  async function createRetail(spec: {
    outlet: OutletKey; train: Train; serviceDate: string; arrival: string
    pay: 'COD' | 'PREPAID'; mix: Mix; contact?: [string, string]
  }) {
    const i = seq++
    const [who, phone] = spec.contact ?? NAMES[i % NAMES.length]
    const { items, amount } = pickItems(menu, spec.mix, i)
    const doc = await createManualOrder(adminCtx, ManualOrderInput.parse({
      orderType: 'RETAIL',
      restaurantId: String(outlets[spec.outlet]._id),
      serviceDate: spec.serviceDate,
      trainNo: spec.train.no,
      trainName: spec.train.name,
      scheduledArrival: spec.arrival,
      coach: COACHES[i % COACHES.length],
      berth: String(1 + ((i * 11) % 72)),
      contactName: who,
      contactPhone: phone,
      amountRupees: String(amount),
      paymentMode: spec.pay,
      items,
    }))
    await tag(doc._id)
    return doc
  }

  const KITCHEN: OrderStatus[] = ['ACCEPTED', 'KOT_PRINTED', 'PREPARED']
  async function kitchenTo(key: OutletKey, id: string, upto: OrderStatus) {
    for (const to of KITCHEN) {
      await transitionOrder({ ctx: kitchenCtx(key), orderId: id, to })
      if (to === upto) break
    }
  }

  async function runFlow(key: OutletKey, doc: OrderDoc, s: Pick<Spec, 'flow' | 'pay' | 'rider' | 'reason'>) {
    const id = String(doc._id)
    const rider = s.rider
    if (rider && !holds(riders[rider], key)) {
      throw new Error(`${rider} is not a rider at ${OUTLET_NAMES[key]}; fix the plan.`)
    }
    const cod = s.pay === 'COD' ? { amountCollectedPaise: doc.amountPaise ?? 0 } : {}
    const dispatch = async () => {
      await kitchenTo(key, id, 'PREPARED')
      await assignAgents({ ctx: adminCtx, orderId: id, agentIds: [String(riders[rider!]._id)] })
      await transitionOrder({ ctx: riderCtx(rider!), orderId: id, to: 'DISPATCHED' })
    }
    switch (s.flow) {
      case 'RECEIVED': return
      case 'ACCEPTED': return kitchenTo(key, id, 'ACCEPTED')
      case 'KOT_PRINTED': return kitchenTo(key, id, 'KOT_PRINTED')
      case 'PREPARED': return kitchenTo(key, id, 'PREPARED')
      case 'PREPARED_ASSIGNED':
        await kitchenTo(key, id, 'PREPARED')
        await assignAgents({ ctx: adminCtx, orderId: id, agentIds: [String(riders[rider!]._id)] })
        return
      case 'DISPATCHED': return dispatch()
      case 'DELIVERED':
      case 'DELIVERED_SETTLED':
        await dispatch()
        await transitionOrder({
          ctx: riderCtx(rider!), orderId: id, to: 'DELIVERED',
          apply: { proofType: 'OTP', proofValue: String(1000 + (hash(id) % 9000)), ...cod },
        })
        if (s.flow === 'DELIVERED_SETTLED') {
          await settleRiderCash({ ctx: adminCtx, riderId: String(riders[rider!]._id), orderIds: [id] })
        }
        return
      case 'FAILED_RTO':
      case 'FAILED_RETURNED':
        await dispatch()
        await transitionOrder({
          ctx: riderCtx(rider!), orderId: id, to: 'FAILED', apply: { failureReason: s.reason ?? 'Passenger not found' },
        })
        if (s.flow === 'FAILED_RETURNED') {
          await markReturnedToOrigin({ ctx: adminCtx, orderId: id, note: 'Bag back at the counter, sealed' })
        }
        return
      case 'CANCELLED_ON_WAY':
        await dispatch()
        await transitionOrder({ ctx: adminCtx, orderId: id, to: 'CANCELLED', meta: { reason: s.reason } })
        return
      case 'CANCELLED':
        if (hash(id) % 2) await kitchenTo(key, id, 'ACCEPTED')
        await transitionOrder({ ctx: adminCtx, orderId: id, to: 'CANCELLED', meta: { reason: s.reason } })
        return
      case 'MISSED':
        await dispatch()
        await transitionOrder({ ctx: telecallerCtx, orderId: id, to: 'MISSED_DELIVERY', meta: { reason: 'Train left before the rider reached the coach' } })
        return
      case 'RATING':
        await kitchenTo(key, id, 'ACCEPTED')
        await flagRatingOrder({ ctx: telecallerCtx, orderId: id })
        return
      case 'CANCEL_REQ':
        await kitchenTo(key, id, 'KOT_PRINTED')
        await requestCancellation(managerCtx, id, s.reason ?? 'Passenger asked to cancel')
        return
    }
  }

  // Today
  const created: { spec: Spec; doc: OrderDoc }[] = []
  for (const s of TODAY) {
    const o = outlets[s.outlet]
    const train = TRAINS[o.stationCode][s.train]
    const doc = await createRetail({
      outlet: s.outlet, train, serviceDate: today, arrival: inMinutes(train.arriveIn), pay: s.pay, mix: s.mix, contact: s.contact,
    })
    await runFlow(s.outlet, doc, s)
    for (const note of s.callNotes ?? []) await appendCallNote(noteCtx(s.outlet), String(doc._id), note)
    if (s.kotNote) await setKotNote(adminCtx, String(doc._id), s.kotNote)
    created.push({ spec: s, doc })
  }

  // Bulk: one today at Annapurna (accepted), one in two days at Ganga Galaxy (Upcoming)
  const inTwoDays = shiftServiceDate(today, 2)
  const bulkToday = await createManualOrder(adminCtx, ManualOrderInput.parse({
    orderType: 'BULK', restaurantId: String(outlets.AN._id), serviceDate: today,
    trainNo: TRAINS.PRYJ[3].no, trainName: TRAINS.PRYJ[3].name, scheduledArrival: inMinutes(TRAINS.PRYJ[3].arriveIn),
    pax: 40, thaliDiet: 'VEG',
    menuSpec: 'Paneer Butter Masala + Dal Tadka + Jeera Rice + 3 Tawa Roti + Salad + Pickle + Gulab Jamun',
    readyBy: inMinutes(TRAINS.PRYJ[3].arriveIn - 60),
    handoverPoint: 'Platform 1, coach S4 door. Group leader Mr Dixit.',
    contactName: 'Mr Dixit', contactPhone: '9450098765',
    amountRupees: '9600', paymentMode: 'INVOICE',
    packingItems: ['Water bottle 500ml', 'Tissue', 'Spoon'],
  }))
  await tag(bulkToday._id)
  await transitionOrder({ ctx: kitchenCtx('AN'), orderId: String(bulkToday._id), to: 'ACCEPTED' })

  const bulkUpcoming = await createManualOrder(adminCtx, ManualOrderInput.parse({
    orderType: 'BULK', restaurantId: String(outlets.GG._id), serviceDate: inTwoDays,
    trainNo: '12554', trainName: 'VAISHALI EXP', scheduledArrival: `${inTwoDays}T19:30`,
    pax: 75, thaliDiet: 'NON_VEG',
    menuSpec: '2pcs Egg Curry + Dry Aloo Jeera + Dal Fry + Jeera Rice + 3 Butter Roti\nSweet (Gulab Jamun) + Salad + Pickle',
    readyBy: `${inTwoDays}T18:30`,
    handoverPoint: 'Coach B5 door, contact Mr Sharma (tour operator)',
    contactName: 'Mr Sharma', contactPhone: '9839066666',
    amountRupees: '18750', paymentMode: 'INVOICE',
    packingItems: ['Water bottle 500ml', 'Tissue', 'Spoon', 'Pickle', 'Salad'],
  }))
  await tag(bulkUpcoming._id)

  // Enquiries: two open, one quoted, one lost
  const enquiries: OrderDoc[] = []
  const ENQ = [
    { station: 'CNB', pax: 60, name: 'Shri Ram Tours', phone: '9415001100', train: '12506', spec: 'Veg thali: paneer, dal, rice, 3 roti, sweet', to: null },
    { station: 'GAYA', pax: 30, name: 'Bodh Gaya Pilgrims Trust', phone: '9431002200', train: '12398', spec: 'Sattvic veg thali, no onion garlic', to: null },
    { station: 'PRYJ', pax: 120, name: 'Kumbh Sewa Samiti', phone: '9450003300', train: '12303', spec: 'Puri sabzi + halwa breakfast packs', to: 'QUOTED' as const },
    { station: 'CNB', pax: 45, name: 'IIT Kanpur alumni', phone: '9839004400', train: '12312', spec: 'Mixed thali, 20 non-veg', to: 'LOST' as const },
  ]
  for (const [i, e] of ENQ.entries()) {
    const serviceDate = shiftServiceDate(today, 1 + i)
    const doc = await createEnquiry(adminCtx, {
      serviceDate, stationCode: e.station, location: 'Platform handover, coach door', trainNo: e.train,
      pax: e.pax, menuSpec: e.spec, thaliDiet: 'VEG', scheduledArrival: `${serviceDate}T13:00`,
      contactName: e.name, contactPhone: e.phone, notes: null,
      rawPaste: `${e.name}\n${e.pax} pax, train ${e.train}, ${serviceDate}\n${e.spec}\nCall ${e.phone}`,
    })
    await Order.updateOne({ _id: doc._id }, { $set: { 'rawPayload.demoV2': true } }, { timestamps: false })
    if (e.to) {
      if (e.to === 'QUOTED') {
        // A quote carries a price and an outlet; the enquiry path leaves both blank.
        await Order.updateOne(
          { _id: doc._id },
          { $set: { amountPaise: e.pax * 16000, paymentMode: 'INVOICE', restaurantId: outlets.AN._id } },
          { timestamps: false },
        )
      }
      await transitionOrder({ ctx: adminCtx, orderId: String(doc._id), to: e.to, meta: e.to === 'LOST' ? { reason: 'Went with another caterer' } : {} })
    }
    enquiries.push(doc)
  }

  // Last week: closed orders, created and walked through now, then backdated
  const past: { doc: OrderDoc; day: string; flow: string }[] = []
  for (let back = 1; back <= 7; back++) {
    const day = shiftServiceDate(today, -back)
    for (const p of PAST_PATTERN[back % PAST_PATTERN.length]) {
      const o = outlets[p.outlet]
      const train = TRAINS[o.stationCode][(back + p.hour) % 6]
      const arrival = `${day}T${String(p.hour).padStart(2, '0')}:${back % 2 ? '35' : '10'}`
      const doc = await createRetail({
        outlet: p.outlet, train, serviceDate: day, arrival, pay: p.pay, mix: (['VEG', 'MIX', 'NON_VEG'] as Mix[])[(back + p.hour) % 3],
      })
      await runFlow(p.outlet, doc, { flow: p.flow, pay: p.pay, rider: p.rider, reason: 'Passenger did not pick up the phone' })
      // Ravi's cash from three days back was handed in: one settled collection in the history.
      if (back === 3 && p.flow === 'DELIVERED' && p.pay === 'COD' && p.rider === 'ravi') {
        await settleRiderCash({ ctx: adminCtx, riderId: String(riders.ravi._id), orderIds: [String(doc._id)] })
      }
      const base = istLocalToUtc(arrival)!
      await backdate(doc._id, new Date(base.getTime() - 2 * HOUR))
      past.push({ doc, day, flow: p.flow })
    }
  }

  /* ── 3. riders on the map ─────────────────────────────────────────────── */
  // Kanpur Central is at 26.4535, 80.3509. Short walks from the concourse out
  // along the platforms; Ravi reporting now, sandeep a few minutes quiet,
  // sanjeet dark for half an hour.
  const walk = (lat0: number, lng0: number, endMinutesAgo: number, points: number) =>
    Array.from({ length: points }, (_, i) => ({
      lat: lat0 + i * 0.00018,
      lng: lng0 + i * 0.00025 * (i % 2 ? 1 : 0.6),
      accuracyMetres: 8 + (i % 4) * 3,
      speedMetresPerSecond: 1.2,
      headingDegrees: 70,
      recordedAt: new Date(now.getTime() - (endMinutesAgo + (points - 1 - i) * 0.5) * MIN),
    }))
  await recordFixes(riders.ravi._id, walk(26.4531, 80.3498, 0.2, 24), now)
  await recordFixes(riders.sandeep._id, walk(26.4542, 80.3515, 6, 16), now)
  await recordFixes(riders.sanjeet._id, walk(26.4525, 80.3522, 25, 10), now)

  /* ── 4. payments ──────────────────────────────────────────────────────── */
  const parser = new SlicePaymentParser()
  const payerOf = (i: number) => NAMES[(i * 5 + 2) % NAMES.length][0].toUpperCase()
  const linkable = created.filter((c) => c.spec.pay === 'PREPAID').map((c) => c.doc.externalOrderId)
  const PAYMENTS = Array.from({ length: 8 }, (_, i) => {
    const daysAgo = [0, 0, 1, 2, 3, 4, 5, 6][i]
    const at = new Date(now.getTime() - daysAgo * 24 * HOUR - (i + 1) * 37 * MIN)
    const rupees = [236, 480, 310, 1250, 198, 640, 420, 9600][i]
    return { at, rupees, rrn: `7311${String(at.getTime()).slice(-8)}`, payer: payerOf(i), method: i === 3 ? 'IMPS' : 'UPI' }
  })
  const paymentIds: string[] = []
  let balance = 18_432.5
  for (const [i, p] of PAYMENTS.entries()) {
    balance += p.rupees
    const d = p.at
    const dd = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: '2-digit' }).format(d).replace(/ /g, '-')
    const body =
      `Hi Gautam,\n  You have received ₹${p.rupees} via ${p.method} in your slice bank account xx8773.\n` +
      `  Avl. Bal. ₹${balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}\n` +
      `     Transaction date   ${dd}\n  From    ${p.payer}\n  RRN     ${p.rrn}\n\n  Best,\n Team slice`
    const parsed = parser.parse(body, d)
    if (!parsed.ok) throw new Error(`Demo slice alert did not parse: ${parsed.detail}`)
    const res = await recordPayment(parsed.payment, { body, subject: 'Money received in your slice account', from: 'slice <no-reply@sliceit.com>', receivedAt: d, demoV2: true }, null, d)
    if (res.status !== 'CREATED') throw new Error(`Payment ${p.rrn} already existed`)
    paymentIds.push(res.paymentId)
    const remark =
      i === 0 && linkable[0] ? `${PAY_PREFIX} ${linkable[0]} prepaid via UPI`
      : i === 2 && linkable[1] ? `${PAY_PREFIX} advance for ${linkable[1]}`
      : i === 7 ? `${PAY_PREFIX} bulk advance, Annapurna 40 pax`
      : `${PAY_PREFIX} unmatched`
    await Payment.updateOne({ _id: res.paymentId }, { $set: { remark, remarkById: admin._id, remarkAt: d } })
  }

  /* ── 5. unparsed inbox ────────────────────────────────────────────────── */
  const olfBody = (id: string, outlet: string, train: string) =>
    `OLF Order Alert\n\nOrder ID: ${id}\nOutlet: ${outlet}\nStation: KANPUR CENTRAL (CNB)\nTrain: ${train}\nCoach/Seat: S6 / 41\n` +
    `Customer: Ramesh Pal, 9839012345\nItems:\n  1 x Veg Deluxe Thali  Rs 260\n  1 x Masala Chai  Rs 30\nPayment: COD Rs 290\nDelivery time: 14:35\n\nRegards,\nOLF Team`
  type InboxSeed = {
    source: string; reason: 'PARSE_FAILED' | 'UNKNOWN_OUTLET' | 'MISSING_FIELD'; detail: string; hoursAgo: number
    from: string; subject: string; body: string
    partial?: Record<string, string>
    resolved?: { resolution: 'ORDER' | 'DISMISSED'; orderId: mongoose.Types.ObjectId | null }
  }
  const INBOX: InboxSeed[] = [
    { source: 'UNKNOWN', reason: 'PARSE_FAILED', detail: 'no parser recognised this email', hoursAgo: 1,
      from: 'IRCTC eCatering <noreply@irctc.co.in>', subject: 'Your e-Catering order 7612345 is confirmed',
      body: 'Dear customer, your order 7612345 for Train 12506 at KANPUR CENTRAL has been confirmed. Vendor: HOTEL GANGA GALAXY. Amount Rs 345. Delivery at 15:10.' },
    { source: 'UNKNOWN', reason: 'PARSE_FAILED', detail: 'no parser recognised this email', hoursAgo: 5,
      from: 'Zoop Support <support@zoopindia.com>', subject: 'Re: Payout statement week 46',
      body: 'Hi team, please find attached the payout statement for week 46. Total settled: Rs 42,310. Let us know of any discrepancy within 48 hours.' },
    { source: 'OLF', reason: 'UNKNOWN_OUTLET', detail: 'no outlet matched "RAJBHOG KHANA" at CNB', hoursAgo: 2,
      from: 'OLF Orders <orders@olf.in>', subject: 'New order OLF-88213 for RAJBHOG KHANA',
      body: olfBody('OLF-88213', 'RAJBHOG KHANA', '12312 KALKA MAIL'),
      partial: { externalOrderId: 'OLF-88213', outletName: 'RAJBHOG KHANA', stationCode: 'CNB', trainNo: '12312' } },
    { source: 'ZOOP', reason: 'UNKNOWN_OUTLET', detail: 'no outlet matched "COSMO LOUNGE" at CNB', hoursAgo: 9,
      from: 'Zoop <orders@zoopindia.com>', subject: 'Zoop order ZP-551920',
      body: `Zoop Order\nOrder No: ZP-551920\nRestaurant: COSMO LOUNGE\nStation: CNB\nTrain: 12310\nSeat: B2/17\nCustomer: Sunil Rao 9876501234\n2 x Paneer Biryani n Raita Combo\nTotal: Rs 560 (Paid)`,
      partial: { externalOrderId: 'ZP-551920', outletName: 'COSMO LOUNGE', stationCode: 'CNB', trainNo: '12310' } },
    { source: 'YATRIBHOJAN', reason: 'MISSING_FIELD', detail: 'no train number found', hoursAgo: 14,
      from: 'YatriBhojan <orders@yatribhojan.com>', subject: 'Order YB-20931',
      body: `YatriBhojan order YB-20931\nOutlet: SHREE ANNAPURNA BHOJNALAYA (PRYJ)\nCustomer: Anjali Mehta 9415098712\nCoach: A1 Berth: 9\n1 x Special Veg Thali Rs 220\nPayment: Online\nTrain: (not provided)`,
      partial: { externalOrderId: 'YB-20931', outletName: 'SHREE ANNAPURNA BHOJNALAYA', stationCode: 'PRYJ' } },
    { source: 'OLF', reason: 'UNKNOWN_OUTLET', detail: 'no outlet matched "GANGA GALXY" at CNB', hoursAgo: 30,
      from: 'OLF Orders <orders@olf.in>', subject: 'New order OLF-88102 for GANGA GALXY',
      body: olfBody('OLF-88102', 'GANGA GALXY', '12554 VAISHALI EXP'),
      partial: { externalOrderId: 'OLF-88102', outletName: 'GANGA GALXY', stationCode: 'CNB', trainNo: '12554' },
      resolved: { resolution: 'ORDER', orderId: created[9].doc._id } },
    { source: 'UNKNOWN', reason: 'PARSE_FAILED', detail: 'no parser recognised this email', hoursAgo: 40,
      from: 'Google <no-reply@accounts.google.com>', subject: 'Security alert',
      body: 'A new sign-in on Windows. We noticed a new sign-in to your Google Account. If this was you, you do not need to do anything.',
      resolved: { resolution: 'DISMISSED', orderId: null } },
  ]
  const inboxIds: string[] = []
  for (const row of INBOX) {
    const at = new Date(now.getTime() - row.hoursAgo * HOUR)
    const doc = await UnparsedInbox.create({
      source: row.source,
      rawPayload: { body: row.body, subject: row.subject, from: row.from, receivedAt: at, demoV2: true },
      reason: row.reason,
      detail: row.detail,
      partial: row.partial ?? null,
      externalOrderId: row.partial?.externalOrderId ?? null,
      resolved: Boolean(row.resolved),
      resolvedAt: row.resolved ? new Date(at.getTime() + 20 * MIN) : null,
      resolvedById: row.resolved ? admin._id : null,
      resolvedOrderId: row.resolved?.orderId ?? null,
      resolution: row.resolved?.resolution ?? null,
    })
    await UnparsedInbox.updateOne({ _id: doc._id }, { $set: { createdAt: at, updatedAt: at } }, { timestamps: false })
    inboxIds.push(String(doc._id))
  }

  /* ── 6. WhatsApp ──────────────────────────────────────────────────────── */
  type Line =
    | { dir: 'IN'; text: string; minutesAgo: number; media?: { url: string; caption: string } }
    | { dir: 'OUT'; text: string; minutesAgo: number; status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'; by: UserDoc; failReason?: string }
  const linkedOrder = created[9].doc // Neha Srivastava, 9000099001
  const CHATS: { phone: string; name: string; lines: Line[]; assign: UserDoc | null; read: boolean }[] = [
    {
      phone: `${WA_PREFIX}001`, name: 'Neha Srivastava', assign: telecaller, read: false,
      lines: [
        { dir: 'IN', text: `Hi, I ordered food for train 12310 today. Order ${linkedOrder.externalOrderId}. Will it reach B4?`, minutesAgo: 95 },
        { dir: 'OUT', text: 'Hello Neha! Yes, your order is confirmed at Hotel Ganga Galaxy, Kanpur Central. Our rider will meet you at the coach door.', minutesAgo: 90, status: 'READ', by: telecaller },
        { dir: 'IN', text: 'Great. Please add a spoon and some tissues.', minutesAgo: 60 },
        { dir: 'OUT', text: 'Noted, spoon and tissues added to the packing.', minutesAgo: 58, status: 'DELIVERED', by: telecaller },
        { dir: 'IN', text: 'Train is running 20 min late as per the app. Please tell the rider.', minutesAgo: 12 },
      ],
    },
    {
      phone: `${WA_PREFIX}002`, name: 'Rajat Khanna', assign: admin, read: true,
      lines: [
        { dir: 'IN', text: 'Is COD available at Prayagraj Jn?', minutesAgo: 300 },
        { dir: 'OUT', text: 'Yes, cash on delivery is available at Prayagraj Jn (Shree Annapurna Bhojnalaya). Which train are you on?', minutesAgo: 296, status: 'READ', by: admin },
        { dir: 'IN', text: '12424 Rajdhani, reaching 8:40 pm. 2 veg thali please.', minutesAgo: 290 },
        { dir: 'OUT', text: 'Booked: 2 x Veg Thali, Rs 360 COD, coach? Please share coach and berth.', minutesAgo: 285, status: 'READ', by: admin },
        { dir: 'IN', text: 'A2 berth 31 and 32', minutesAgo: 280 },
        { dir: 'OUT', text: 'Done. The rider will be at A2 when the train halts. Thank you!', minutesAgo: 278, status: 'READ', by: admin },
      ],
    },
    {
      phone: `${WA_PREFIX}003`, name: 'Suman Lata', assign: null, read: false,
      lines: [
        { dir: 'IN', text: 'The thali I got at Gaya was cold and the roti was hard. See the photo.', minutesAgo: 45 },
        { dir: 'IN', text: '', minutesAgo: 44, media: { url: 'https://picsum.photos/seed/railserve-thali/640/480', caption: 'Thali from train 12398' } },
        { dir: 'IN', text: 'I want a refund.', minutesAgo: 40 },
      ],
    },
    {
      phone: `${WA_PREFIX}004`, name: 'Dinesh Prasad', assign: admin, read: true,
      lines: [
        { dir: 'IN', text: 'Do you deliver at Kanpur for 15631 tomorrow morning?', minutesAgo: 31 * 60 },
        { dir: 'OUT', text: 'Yes we do, 15631 reaches CNB around 7:20. We can deliver breakfast; menu attached shortly.', minutesAgo: 30 * 60 + 50, status: 'DELIVERED', by: admin },
        { dir: 'OUT', text: 'Here is the breakfast menu: Aloo Paratha with Curd Rs 180, Poha Rs 90, Masala Chai Rs 30.', minutesAgo: 30 * 60 + 40, status: 'FAILED', by: admin, failReason: 'Message undeliverable: recipient number not on WhatsApp' },
        { dir: 'IN', text: 'Ok will confirm tonight', minutesAgo: 30 * 60 + 10 },
      ],
    },
  ]
  const chatIds: string[] = []
  for (const c of CHATS) {
    let convId: string | null = null
    for (const l of c.lines) {
      const at = new Date(now.getTime() - l.minutesAgo * MIN)
      if (l.dir === 'IN') {
        const r = await recordInbound({
          type: 'inbound', phone: c.phone, customerName: c.name, providerMessageId: `demo-v2.${randomUUID()}`,
          kind: l.media ? 'MEDIA' : 'TEXT', text: l.text || null, button: null,
          mediaUrl: l.media?.url ?? null, mediaCaption: l.media?.caption ?? null, mediaType: l.media ? 'image' : null, at,
        })
        convId = r.conversationId
      } else {
        if (!convId) throw new Error('A demo chat must open with an inbound line')
        // No repo path writes a historical outbound line (sendText would ask the
        // simulator, which answers back), so this is written as recordOutbound would.
        await WaMessage.create({
          conversationId: new mongoose.Types.ObjectId(convId), direction: 'OUT', kind: 'TEXT', text: l.text,
          status: l.status, statusAt: new Date(at.getTime() + 20_000), failReason: l.failReason ?? null,
          providerMessageId: `demo-v2.${randomUUID()}`, sentBy: l.by._id, createdAt: at,
        })
        await WaConversation.updateOne(
          { _id: convId },
          { $set: { lastMessageAt: at, lastMessageText: l.text, lastMessageDirection: 'OUT' } },
        )
      }
    }
    if (c.read) await markRead(adminCtx, convId!)
    await assignConversation(adminCtx, convId!, c.assign ? String(c.assign._id) : null)
    chatIds.push(convId!)
  }

  /* ── summary ──────────────────────────────────────────────────────────── */
  const all = [...created.map((c) => c.doc._id), bulkToday._id, bulkUpcoming._id, ...enquiries.map((e) => e._id), ...past.map((p) => p.doc._id)]
  const final = await Order.find({ _id: { $in: all } }).select('externalOrderId status serviceDate delivery.rto cancelRequest').lean()
  const byStatus = new Map<string, number>()
  for (const o of final) byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1)

  console.log(`\norders  : ${final.length} (${created.length} retail today, 2 bulk, ${enquiries.length} enquiries, ${past.length} over the last 7 days)`)
  for (const [s, n] of [...byStatus.entries()].sort()) console.log(`          ${s.padEnd(16)} ${n}`)
  console.log(`          RTO pending      ${final.filter((o) => o.delivery?.rto?.status === 'PENDING').length}`)
  console.log(`          RTO returned     ${final.filter((o) => o.delivery?.rto?.status === 'RETURNED').length}`)
  console.log(`          cancel requests  ${final.filter((o) => o.cancelRequest?.status === 'PENDING').length}`)
  console.log(`\nkey ids :`)
  const show = (label: string, i: number) => console.log(`          ${label.padEnd(26)} ${created[i].doc.externalOrderId}  ${created[i].doc._id}`)
  show('chat-linked (Neha)', 9)
  show('failed + RTO pending', 2)
  show('missed delivery', 7)
  show('rating order', 11)
  show('cancel request (GG)', 8)
  console.log(`          ${'bulk upcoming'.padEnd(26)} ${bulkUpcoming.externalOrderId}  ${bulkUpcoming._id}`)
  console.log(`          ${'enquiry QUOTED'.padEnd(26)} ${enquiries[2].externalOrderId}  ${enquiries[2]._id}`)
  console.log(`\nriders  : Ravi LIVE, sandeep IDLE (~6 min), sanjeet OFFLINE (~25 min), all near Kanpur Central`)
  console.log(`payments: ${paymentIds.length} slice alerts, linked remarks -> ${linkable.slice(0, 2).join(', ')}`)
  console.log(`inbox   : ${inboxIds.length} rows (${INBOX.filter((r) => !r.resolved).length} open, ${INBOX.filter((r) => r.resolved).length} resolved)`)
  console.log(`chats   : ${chatIds.length} threads on 9000099001-004 -> ${chatIds.join(', ')}`)
  console.log(`\nSign in as 9000000001 (admin) and open /v2.`)

  await disconnectDb()
}

/**
 * Moves a freshly-walked order back in time: creation, every event, the
 * delivery stamps, call notes and settlement, spaced a few minutes apart from
 * `base`. The order's content is untouched. No repo path exists for this
 * because nothing in production ever needs it.
 */
async function backdate(orderId: mongoose.Types.ObjectId, base: Date) {
  const o = await Order.findById(orderId).lean()
  if (!o) return
  const step = 6 * MIN
  const events = o.events.map((e, i) => ({ ...e, createdAt: new Date(base.getTime() + (i + 1) * step) }))
  const at = (status: string) => events.find((e) => e.toStatus === status && e.fromStatus !== status)?.createdAt ?? null
  const last = events[events.length - 1]?.createdAt ?? base
  const $set: Record<string, unknown> = {
    createdAt: base,
    updatedAt: last,
    events,
    callLog: o.callLog.map((n, i) => ({ ...n, createdAt: new Date(last.getTime() + (i + 1) * MIN) })),
    'rawPayload.backdated': true,
  }
  if (o.delivery?.assignedAt) $set['delivery.assignedAt'] = at('PREPARED') ?? base
  if (o.delivery?.dispatchedAt) $set['delivery.dispatchedAt'] = at('DISPATCHED')
  if (o.delivery?.deliveredAt) $set['delivery.deliveredAt'] = at('DELIVERED')
  if (o.delivery?.closedAt) $set['delivery.closedAt'] = last
  if (o.delivery?.rto?.openedAt) $set['delivery.rto.openedAt'] = last
  if (o.delivery?.codSettledAt) $set['delivery.codSettledAt'] = last
  await Order.updateOne({ _id: orderId }, { $set }, { timestamps: false })
}

main().catch((err) => {
  console.error('\nseed:v2 FAILED:', err instanceof Error ? err.stack ?? err.message : err)
  process.exit(1)
})
