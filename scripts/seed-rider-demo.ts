/**
 * Test data for the rider app.
 *
 * Adds one outlet, a store manager and a rider, then puts orders into the two
 * states the rider screen is built around: PREPARED (waiting at the counter,
 * "pick up") and DISPATCHED (in the rider's hands, "deliver now"). Without
 * both, half the screen is untestable.
 *
 * Additive for staff — it leaves any existing admin alone, so it can be run
 * against a database that has already been reset to a single account. Today's
 * orders for the demo outlet are replaced rather than added to, so re-running
 * gives the same board instead of piling up test data.
 *
 * One train is deliberately large. A rider picks the orders they can carry,
 * and that behaviour is untestable on a train with three.
 *
 *   npm run seed:rider
 */
import bcrypt from 'bcryptjs'
import { connectDb, disconnectDb } from '../src/lib/db'
import { Restaurant, User } from '../src/lib/models'
import { __unsafeOrderModel as Order } from '../src/lib/repo/orderRepo'
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

  // Two trains so grouping is visible, one of them big enough that a rider
  // has to choose. Arrivals near enough that the urgency colours fire.
  const NAMES = [
    ['Neelesh Soni', '9752446747'], ['Anita Verma', '9839044444'],
    ['Rakesh Tiwari', '9901213344'], ['Sneha Patel', '9555533221'],
    ['Amit Kumar', '9876543210'], ['Priya Nair', '9812345678'],
    ['Vikram Singh', '9700011122'], ['Fatima Sheikh', '9822233344'],
    ['Deepak Yadav', '9911122233'], ['Meera Joshi', '9765432109'],
    ['Arjun Reddy', '9988776655'], ['Kavita Rao', '9871122334'],
    ['Sanjay Gupta', '9099887766'], ['Rhea D Souza', '9822119900'],
  ]
  const COACHES = ['B1', 'B2', 'B3', 'A1', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'B4', 'B5', 'A2', 'S7']
  const DISHES = [
    ['Paneer Paratha With Curd Combo', '236'], ['Veg Thali', '480'],
    ['Chicken Biryani', '310'], ['Masala Dosa', '198'],
    ['Rajma Chawal', '420'], ['Chole Bhature', '260'],
  ]

  const orders = NAMES.map(([who, phone], i) => {
    const big = i < 10
    const [item, amount] = DISHES[i % DISHES.length]
    return {
      train: big ? '12506' : '12312',
      name: big ? 'NORTH EAST EXP' : 'KALKA MAIL',
      arriveIn: big ? 18 : 55,
      coach: COACHES[i],
      berth: String(12 + i * 3),
      who, phone,
      cod: i % 3 !== 0,
      amount, item,
    }
  })

  // Clear this outlet's board for today so the seed is repeatable. Scoped to
  // the demo outlet and the current service date — it cannot touch real data.
  const removed = await Order.deleteMany({ restaurantId: outlet._id, serviceDate: today })
  if (removed.deletedCount) console.log(`cleared: ${removed.deletedCount} previous demo order(s)`)

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

  // Two already in the rider's hands, so "Deliver now" has something in it the
  // moment they open the app. The rest stay at the counter to be picked from.
  for (const id of created.slice(0, 2)) {
    await transitionOrder({ ctx: riderCtx, orderId: id, to: 'DISPATCHED' })
  }

  // Two carried all the way through, so the Delivered tab has a record and a
  // cash total to show rather than an empty state.
  for (const [i, id] of created.slice(2, 4).entries()) {
    const o = orders[i + 2]
    await transitionOrder({ ctx: riderCtx, orderId: id, to: 'DISPATCHED' })
    await transitionOrder({
      ctx: riderCtx,
      orderId: id,
      to: 'DELIVERED',
      apply: {
        proofType: 'SIGNATURE',
        proofValue: o.who,
        ...(o.cod ? { amountCollectedPaise: Number(o.amount) * 100 } : {}),
      },
    })
  }

  console.log(`\norders : ${created.length} created`)
  console.log(`         2 DISPATCHED  -> rider sees "Deliver now"`)
  console.log(`         2 DELIVERED   -> rider sees them under "Delivered"`)
  console.log(`         ${created.length - 4} PREPARED    -> rider picks which ones to take`)
  console.log(`\nrider login: 9000000004 / ${PASSWORD}`)
  console.log(`store login: 9000000002 / ${PASSWORD}`)

  await disconnectDb()
}

main().catch((err) => {
  console.error('\nFAILED:', err.message)
  process.exit(1)
})
