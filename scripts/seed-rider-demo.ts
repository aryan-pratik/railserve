/**
 * Test data for the rider app.
 *
 * Adds one outlet, a store manager and a rider, then puts orders into the two
 * states the rider screen is built around: PREPARED (waiting at the counter,
 * "pick up") and DISPATCHED (in the rider's hands, "deliver now"). Without
 * both, half the screen is untestable.
 *
 * Additive on purpose — it leaves any existing admin alone, so it can be run
 * against a database that has already been reset to a single account.
 *
 *   npm run seed:rider
 */
import bcrypt from 'bcryptjs'
import { connectDb, disconnectDb } from '../src/lib/db'
import { Restaurant, User } from '../src/lib/models'
import { createManualOrder } from '../src/lib/repo/createOrder'
import { transitionOrder } from '../src/lib/repo/transitionOrder'
import { ManualOrderInput } from '../src/lib/validation/order'
import { todayIST, utcToIstLocal } from '../src/lib/format'
import type { AuthContext } from '../src/lib/authContext'

const PASSWORD = 'rider@123'

/** An IST local datetime string this many minutes from now. */
const inMinutes = (n: number) => utcToIstLocal(new Date(Date.now() + n * 60_000))

async function main() {
  await connectDb()
  const today = todayIST()

  const outlet = (await Restaurant.findOneAndUpdate(
    { name: 'HOTEL GANGA GALAXY' },
    {
      $set: {
        name: 'HOTEL GANGA GALAXY',
        stationCode: 'CNB',
        stationName: 'KANPUR CENTRAL',
        aliases: ['GANGA GALAXY'],
        walkToPlatformMinutes: 10,
      },
      $setOnInsert: { active: true },
    },
    { upsert: true, returnDocument: 'after' },
  ))!
  console.log(`outlet : ${outlet.name} (${outlet.stationCode})`)

  const passwordHash = await bcrypt.hash(PASSWORD, 10)
  const staff = [
    { name: 'Manoj Kumar', phone: '9000000002', role: 'STORE_MANAGER' as const },
    { name: 'Ravi Kumar', phone: '9000000004', role: 'DELIVERY_AGENT' as const },
  ]
  for (const u of staff) {
    await User.findOneAndUpdate(
      { phone: u.phone },
      { $set: { ...u, passwordHash, restaurantIds: [outlet._id] }, $setOnInsert: { active: true } },
      { upsert: true, returnDocument: 'after' },
    )
    console.log(`user   : ${u.phone}  ${u.role.padEnd(15)} ${u.name}`)
  }

  const admin = await User.findOne({ role: 'ADMIN', active: true })
  if (!admin) throw new Error('No admin found — create one first (npm run reset:admin -- --yes)')
  const adminCtx: AuthContext = { userId: admin._id, role: 'ADMIN', restaurantIds: [] }

  const manager = (await User.findOne({ phone: '9000000002' }))!
  const rider = (await User.findOne({ phone: '9000000004' }))!
  const managerCtx: AuthContext = {
    userId: manager._id, role: 'STORE_MANAGER', restaurantIds: [outlet._id],
  }
  const riderCtx: AuthContext = {
    userId: rider._id, role: 'DELIVERY_AGENT', restaurantIds: [outlet._id],
  }

  // Two trains so grouping is visible, and arrivals near enough that the
  // urgency colours actually fire.
  const orders = [
    { train: '12506', name: 'NORTH EAST EXP', arriveIn: 18, coach: 'B5', berth: '37', who: 'Neelesh Soni', phone: '9752446747', cod: true,  amount: '236', item: 'Paneer Paratha With Curd Combo' },
    { train: '12506', name: 'NORTH EAST EXP', arriveIn: 18, coach: 'S3', berth: '45', who: 'Anita Verma',  phone: '9839044444', cod: false, amount: '480', item: 'Veg Thali' },
    { train: '12506', name: 'NORTH EAST EXP', arriveIn: 18, coach: 'A1', berth: '12', who: 'Rakesh Tiwari', phone: '9901213344', cod: true,  amount: '310', item: 'Chicken Biryani' },
    { train: '12312', name: 'KALKA MAIL',     arriveIn: 55, coach: 'B2', berth: '28', who: 'Sneha Patel',  phone: '9555533221', cod: true,  amount: '198', item: 'Masala Dosa' },
    { train: '12312', name: 'KALKA MAIL',     arriveIn: 55, coach: 'S6', berth: '04', who: 'Amit Kumar',   phone: '9876543210', cod: false, amount: '420', item: 'Rajma Chawal' },
  ]

  const created: string[] = []
  for (const o of orders) {
    const doc = await createManualOrder(
      adminCtx,
      ManualOrderInput.parse({
        orderType: 'RETAIL',
        restaurantId: String(outlet._id),
        serviceDate: today,
        trainNo: o.train,
        trainName: o.name,
        scheduledArrival: inMinutes(o.arriveIn),
        coach: o.coach,
        berth: o.berth,
        contactName: o.who,
        contactPhone: o.phone,
        amountRupees: o.amount,
        paymentMode: o.cod ? 'COD' : 'PREPAID',
        items: [{ name: o.item, qty: 1, priceRupees: o.amount, isPacking: false }],
      }),
    )
    created.push(String(doc._id))
  }

  // Everything through the kitchen, so it is all sitting ready to collect.
  for (const id of created) {
    for (const to of ['ACCEPTED', 'KOT_PRINTED', 'PREPARED'] as const) {
      await transitionOrder({ ctx: managerCtx, orderId: id, to })
    }
  }

  // The first two are already in the rider's hands, so "Deliver now" has
  // something in it the moment they open the app.
  for (const id of created.slice(0, 2)) {
    await transitionOrder({ ctx: riderCtx, orderId: id, to: 'DISPATCHED' })
  }

  console.log(`\norders : ${created.length} created`)
  console.log('         2 DISPATCHED  -> rider sees "Deliver now"')
  console.log('         3 PREPARED    -> rider sees "Pick up from shop"')
  console.log(`\nrider login: 9000000004 / ${PASSWORD}`)
  console.log(`store login: 9000000002 / ${PASSWORD}`)

  await disconnectDb()
}

main().catch((err) => {
  console.error('\nFAILED:', err.message)
  process.exit(1)
})
