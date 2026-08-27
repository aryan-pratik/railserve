/**
 * Creates a handful of orders so the dashboards have something in them.
 * Optional and idempotent-by-replacement:  npm run seed:orders
 */
import { connectDb, disconnectDb } from '../src/lib/db'
import { Order, Restaurant, User } from '../src/lib/models'
import { createManualOrder } from '../src/lib/repo/createOrder'
import { ManualOrderInput } from '../src/lib/validation/order'
import { todayIST, shiftServiceDate } from '../src/lib/format'
import type { AuthContext } from '../src/lib/authContext'

async function main() {
  await connectDb()

  const admin = await User.findOne({ role: 'ADMIN' })
  if (!admin) throw new Error('No admin user. Run `npm run seed` first.')
  const ctx: AuthContext = { userId: admin._id, role: 'ADMIN', restaurantId: null }

  const ganga = await Restaurant.findOne({ name: 'HOTEL GANGA GALAXY' })
  const annapurna = await Restaurant.findOne({ name: 'SHREE ANNAPURNA BHOJNALAYA' })
  if (!ganga || !annapurna) throw new Error('Seed outlets missing. Run `npm run seed` first.')

  const removed = await Order.deleteMany({ 'rawPayload.demo': true })
  if (removed.deletedCount) console.log(`Replaced ${removed.deletedCount} previous demo order(s).\n`)

  const today = todayIST()
  const inTwoDays = shiftServiceDate(today, 2)

  const specs = [
    {
      label: 'retail · Ganga Galaxy · today',
      input: {
        orderType: 'RETAIL', restaurantId: String(ganga._id), serviceDate: today,
        trainNo: '12506', trainName: 'NORTH EAST EXP',
        scheduledArrival: `${today}T13:25`,
        coach: 'B5', berth: '37',
        contactName: 'Neelesh Soni', contactPhone: '9752446747',
        amountRupees: '236', paymentMode: 'COD',
        items: [{ name: 'Paneer Paratha With Curd Combo', qty: 1, priceRupees: '236', isPacking: false }],
      },
    },
    {
      label: 'retail · Ganga Galaxy · today · multi-item, prepaid',
      input: {
        orderType: 'RETAIL', restaurantId: String(ganga._id), serviceDate: today,
        trainNo: '12506', trainName: 'NORTH EAST EXP',
        scheduledArrival: `${today}T13:25`,
        coach: 'S3', berth: '45',
        contactName: 'Anita Verma', contactPhone: '9839044444',
        amountRupees: '480', paymentMode: 'PREPAID',
        items: [
          { name: 'Veg Thali', qty: 2, priceRupees: '180', isPacking: false },
          { name: 'Masala Chai', qty: 2, priceRupees: '30', isPacking: false },
          { name: 'Tissue', qty: 2, priceRupees: '', isPacking: true },
        ],
      },
    },
    {
      label: 'retail · Annapurna · today (different outlet — proves isolation)',
      input: {
        orderType: 'RETAIL', restaurantId: String(annapurna._id), serviceDate: today,
        trainNo: '12312', trainName: 'KALKA MAIL',
        scheduledArrival: `${today}T09:40`,
        coach: 'A1', berth: '12',
        contactName: 'Rakesh Tiwari', contactPhone: '9839055555',
        amountRupees: '310', paymentMode: 'COD',
        items: [{ name: 'Chicken Biryani', qty: 1, priceRupees: '310', isPacking: false }],
      },
    },
    {
      label: 'bulk · Ganga Galaxy · in two days (Upcoming tab)',
      input: {
        orderType: 'BULK', restaurantId: String(ganga._id), serviceDate: inTwoDays,
        trainNo: '12554', trainName: 'VAISHALI EXP',
        scheduledArrival: `${inTwoDays}T19:30`,
        pax: 75,
        menuSpec:
          '2pcs Egg Curry + Dry aloo jeera + Dal Fry + Jeera Rice + 3 Butter Roti\n' +
          'Sweet (Gulab Jamun) + Salad + Pickle',
        readyBy: `${inTwoDays}T18:30`,
        handoverPoint: 'coach B5 door, contact Mr Sharma',
        contactName: 'Mr Sharma', contactPhone: '9839066666',
        amountRupees: '18750', paymentMode: 'INVOICE',
        packingItems: ['Water bottle 500ml', 'Tissue', 'Spoon', 'Pickle', 'Salad'],
      },
    },
  ]

  for (const s of specs) {
    const order = await createManualOrder(ctx, ManualOrderInput.parse(s.input))
    // Tag it so a re-run replaces rather than duplicates.
    await Order.updateOne({ _id: order._id }, { $set: { rawPayload: { demo: true } } })
    console.log(`  ✓ ${order.externalOrderId}  ${s.label}`)
  }

  console.log('\nDone. Sign in as 9000000002 (Ganga Galaxy) to see three of these,')
  console.log('and 9000000003 (Annapurna) to see exactly one.')
  await disconnectDb()
}

main().catch((err) => {
  console.error('\nDemo order seed FAILED:', err.message)
  process.exit(1)
})
