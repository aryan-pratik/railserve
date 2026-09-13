/**
 * Feeds every real BrotherByte and Yatribhojan order sample gathered while
 * fixing their parsers straight through the actual ingestEmail() pipeline
 * (parse -> matchOutlet -> createOrderFromParsed), so they show up on the
 * local dashboard exactly as they would from a real inbound email.
 * Idempotent by explicit check rather than the unique index — some
 * environments don't have `externalOrderId_unique` built (run `npm run
 * indexes` to add it), and without it ingestEmail()'s own dedupe silently
 * inserts a duplicate Order instead of erroring, so this looks each sample
 * up first and skips it if already present.
 *
 * Assumes "The Cosmozin Lounge" and "Yatri Bhojan" are already registered
 * outlets (CNB) — this only ingests orders, it doesn't touch Restaurant.
 * If matchOutlet reports UNKNOWN_OUTLET, register them first (see
 * scripts/seed.ts for the pattern) rather than upserting by exact name here:
 * a name-cased-differently upsert creates a second outlet the real one
 * already has, which then makes every match ambiguous.
 *
 *   npm run seed:samples
 */
import { connectDb, disconnectDb } from '../src/lib/db'
import { Order } from '../src/lib/models'
import { ingestEmail } from '../src/lib/ingest'

// Verbatim BrotherByte order-confirmation emails, as received.
const BROTHERBYTE_SAMPLES = [
  {
    label: '2-item order (Chicken Biryani x2, Veg Biryani x1)',
    externalOrderId: '2485656222',
    body: `Dear The Cosmozin Lounge,

A new order has been confirmed for your outlet.

Order ID\tBB00101417/2485656222
Train\t12561/SWATANTRA S EXP
Station\tKANPUR CENTRAL (CNB)
Delivery Date & ETA\t09-13-2026 09:35 IST
Coach & Berth\tS6/11
Customer\tRaja kumar (8409170572)
Items\t2-Chicken Biryani With Raita Combo (non-veg) - Chicken Biryani 2pcs, Raita, Chilli Sauce, Tomato Sauce, Salad, Pickle, Gulab Jamun, Spoon, Tissue Paper, # 1-Veg Biryani With Raita Combo (veg) - Veg Biryani, Raita, Chilli Sauce, Tomato Sauce, Salad, Pickle, Gulab Jamun, Spoon, Tissue Paper
Payment Method\tCash On Delivery
Order Total\t₹684.60
GST/Tax\t₹32.60
Discount\t₹0
Outlet Discount\t₹0
Amount to Collect\t₹685
Customer Notes\tProvide Good food
Regards,
Team BrotherByte`,
  },
  {
    label: 'Aloo Paratha Combo x1',
    externalOrderId: '2485666371',
    body: `Dear The Cosmozin Lounge,

A new order has been confirmed for your outlet.

Order ID\tBB00101415/2485666371
Train\t15083/CPR FBD EXPRESS
Station\tKANPUR CENTRAL (CNB)
Delivery Date & ETA\t09-13-2026 09:25 IST
Coach & Berth\tS1/73
Customer\tArnav Agarwal (9044584440)
Items\t1-Aloo Paratha With Curd Combo (veg) - Aalu Paratha 2pcs, Curd, Chilli Sauce, Tomato Sauce, Salad, Pickle, Spoon, Tissue Paper
Payment Method\tCash On Delivery
Order Total\t₹182.70
GST/Tax\t₹8.70
Discount\t₹0
Outlet Discount\t₹0
Amount to Collect\t₹183
Customer Notes\tProvide Good food
Regards,
Team BrotherByte`,
  },
  {
    label: 'Veg Mini Thali x4 (single line, qty 4)',
    externalOrderId: '2485566709',
    body: `Dear The Cosmozin Lounge,

A new order has been confirmed for your outlet.

Order ID\tBB00101413/2485566709
Train\t12522/RAPTISAGAR EXP
Station\tKANPUR CENTRAL (CNB)
Delivery Date & ETA\t09-13-2026 08:00 IST
Coach & Berth\tRAC/S2/23
Customer\tManoj singh (8807411138)
Items\t4-Veg Mini Thali (veg) - Seasonal Veg, Dal Fry, Jeera Rice, Tawa Roti 2pcs, Salad, Pickle, Gulab Jamun, Spoon, Tissue Paper
Payment Method\tCash On Delivery
Order Total\t₹600.60
GST/Tax\t₹28.60
Discount\t₹0
Outlet Discount\t₹0
Amount to Collect\t₹601
Customer Notes\tProvide Good food
Regards,
Team BrotherByte`,
  },
  {
    label: 'Chicken Biryani Combo x1 (tab-separated layout)',
    externalOrderId: '2485257102',
    body: `Dear The Cosmozin Lounge,

A new order has been confirmed for your outlet.

Order ID\tBB00101303/2485257102
Train\t12323/HWH BME EXP
Station\tKANPUR CENTRAL (CNB)
Delivery Date & ETA\t09-12-2026 09:10 IST
Coach & Berth\tB5/66
Customer\tABHISHEK VAISNAV (7984434724)
Items\t1-Chicken Biryani With Raita Combo (non-veg) - Chicken Biryani 2pcs, Raita, Chilli Sauce, Tomato Sauce, Salad, Pickle, Gulab Jamun, Spoon, Tissue Paper
Payment Method\tCash On Delivery
Order Total\t₹243.60
GST/Tax\t₹11.60
Discount\t₹0
Outlet Discount\t₹0
Amount to Collect\t₹244
Customer Notes\tProvide Good food
Regards,
Team BrotherByte`,
  },
  {
    label: 'Chicken Curry With Roti Combo x1',
    externalOrderId: '2485467494',
    body: `Dear The Cosmozin Lounge,

A new order has been confirmed for your outlet.

Order ID\tBB00101382/2485467494
Train\t12314/SEALDAH RAJDHNI
Station\tKANPUR CENTRAL (CNB)
Delivery Date & ETA\t09-12-2026 21:10 IST
Coach & Berth\tB2/1
Customer\tSubhankar Ghosh (8583978399)
Items\t1-Chicken Curry With Roti Combo (non-veg) - Chicken Curry 2pcs, Tawa Roti 3pcs, Salad, Gulab Jamun, Spoon, Tissue Paper
Payment Method\tCash On Delivery
Order Total\t₹197.40
GST/Tax\t₹9.40
Discount\t₹0
Outlet Discount\t₹0
Amount to Collect\t₹197
Customer Notes\tProvide Good food
Regards,
Team BrotherByte`,
  },
  {
    label: 'Veg Deluxe Thali x1 (single tab separator, ISO date, no notes)',
    externalOrderId: '2485434969',
    body: `Dear The Cosmozin Lounge,

A new order has been confirmed for your outlet.

Order ID\tBB00101354/2485434969
Train\t15084/FBD CPR EXPRESS
Station\tKANPUR CENTRAL (CNB)
Delivery Date & ETA\t2026-09-12 17:40 IST
Coach & Berth\tB2/23
Customer\tUtkarsh Yadav (6392455514)
Items\t1-Veg Deluxe Thali (veg)
Payment Method\tCash On Delivery
Order Total\t₹227.31
GST/Tax\t₹10.31
Discount\t₹0
Outlet Discount\t₹10.85
Amount to Collect\t₹216
Customer Notes\tProvide Good food
Regards,
Team BrotherByte`,
  },
  {
    label: 'Amritsari Thali x1',
    externalOrderId: '2485260978',
    body: `Dear The Cosmozin Lounge,

A new order has been confirmed for your outlet.

Order ID\tBB00101304/2485260978
Train\t12323/HWH BME EXP
Station\tKANPUR CENTRAL (CNB)
Delivery Date & ETA\t09-12-2026 09:10 IST
Coach & Berth\tB5/66
Customer\tABHISHEK VAISNAV (7984434724)
Items\t1-Amritsari Thali (veg) - Matar Paneer, Chole, Dal Tadka, Jeera Rice, Butter Tawa Roti 3pcs, Salad, Pickle, Gulab Jamun, Spoon, Tissue Paper
Payment Method\tCash On Delivery
Order Total\t₹213.15
GST/Tax\t₹10.15
Discount\t₹0
Outlet Discount\t₹0
Amount to Collect\t₹213
Customer Notes\tProvide Good food
Regards,
Team BrotherByte`,
  },
]

// Reconstructed from the admin dashboard's rendered order details (the
// literal source emails weren't available) — field-for-field faithful to
// the real order no, customer, train, seat, item and total shown there.
const YATRIBHOJAN_SAMPLES = [
  {
    label: 'Chicken Biryani Combo x1 (coach H1/C — alphanumeric coach)',
    externalOrderId: '57614593',
    body: `TEAM YATRIBHOJAN

ORDER NO: 57614593
PAYMODE: PREPAID
-----
DELIVERY: 11-09-2026, ETA: 21:50
STATION: KANPUR CENTRAL (CNB)
TRAIN: 12310, RJPB TEJAS RAJ
COACH: H1/C, SEAT: 9
NAME: Rupesh
MOB: 7858095122
-----
ITEM DETAILS
****
Chicken Biryani With Raita Combo X 1
****
NET TOTAL: Rs. 230.00

TEAM YATRIBHOJAN`,
  },
  {
    label: 'Aloo Paratha With Chole Combo x1 (coach H1/D)',
    externalOrderId: '57615301',
    body: `TEAM YATRIBHOJAN

ORDER NO: 57615301
PAYMODE: COD
-----
DELIVERY: 13-09-2026, ETA: 08:00
STATION: KANPUR CENTRAL (CNB)
TRAIN: 12522, RAPTISAGAR EXP
COACH: H1/D, SEAT: 11
NAME: Vivek
MOB: 8075771877
-----
ITEM DETAILS
****
Aloo Paratha With Chole Combo X 1
****
NET TOTAL: Rs. 175.00

TEAM YATRIBHOJAN`,
  },
]

async function ingestIfMissing(s: { label: string; externalOrderId: string; body: string }) {
  const exists = await Order.exists({ externalOrderId: s.externalOrderId })
  if (exists) {
    console.log(`  SKIPPED    ${s.label} (already in db)`)
    return
  }
  const outcome = await ingestEmail({ body: s.body, receivedAt: new Date() })
  console.log(`  ${outcome.status.padEnd(10)} ${s.label}`)
  if (outcome.status === 'UNPARSED') console.log(`             ${outcome.reason}: ${outcome.detail}`)
}

async function main() {
  await connectDb()

  console.log('BrotherByte samples')
  for (const s of BROTHERBYTE_SAMPLES) await ingestIfMissing(s)

  console.log('\nYatribhojan samples')
  for (const s of YATRIBHOJAN_SAMPLES) await ingestIfMissing(s)

  await disconnectDb()
}

main().catch((err) => {
  console.error('\nSample order seed FAILED:', err.message)
  process.exit(1)
})
