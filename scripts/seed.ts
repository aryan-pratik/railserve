/**
 * Seeds the dev dataset from plan §11 Phase 1:
 * 2 restaurants, 1 admin, 2 store managers, 2 delivery agents.
 *
 * Idempotent — upserts by natural key, so re-running does not duplicate.
 * Pass --reset to also delete every order first.
 *
 *   npm run seed
 *   npm run seed -- --reset
 */
import bcrypt from 'bcryptjs'
import { connectDb, disconnectDb } from '../src/lib/db'
import { Order, Restaurant, User } from '../src/lib/models'
import { env } from '../src/lib/env'

const RESTAURANTS = [
  {
    name: 'HOTEL GANGA GALAXY',
    stationCode: 'CNB',
    stationName: 'KANPUR CENTRAL',
    aliases: ['GANGA GALAXY', 'HOTEL GANGA GALAXY CNB'],
    contactName: 'Ramesh Gupta',
    contactPhone: '9839011111',
    walkToPlatformMinutes: 10,
  },
  {
    name: 'SHREE ANNAPURNA BHOJNALAYA',
    stationCode: 'PRYJ',
    stationName: 'PRAYAGRAJ JN',
    aliases: ['ANNAPURNA BHOJNALAYA', 'SHREE ANNAPURNA'],
    contactName: 'Sunita Devi',
    contactPhone: '9839022222',
    walkToPlatformMinutes: 14,
  },
]

async function main() {
  const reset = process.argv.includes('--reset')
  await connectDb()

  if (reset) {
    const { deletedCount } = await Order.deleteMany({})
    console.log(`--reset: deleted ${deletedCount} order(s)\n`)
  }

  const passwordHash = await bcrypt.hash(env.SEED_PASSWORD, 10)

  console.log('restaurants')
  const restaurants = []
  for (const r of RESTAURANTS) {
    const doc = await Restaurant.findOneAndUpdate(
      { name: r.name },
      { $set: r, $setOnInsert: { active: true } },
      { upsert: true, returnDocument: 'after' },
    )
    restaurants.push(doc!)
    console.log(`  ✓ ${r.name}  (${r.stationCode}, walk ${r.walkToPlatformMinutes}m)`)
  }

  const users = [
    { name: 'Aryan Sinha', phone: '9000000001', role: 'ADMIN' as const, restaurantId: null },
    {
      name: 'Manoj Ganga Galaxy',
      phone: '9000000002',
      role: 'STORE_MANAGER' as const,
      restaurantId: restaurants[0]._id,
    },
    {
      name: 'Kavita Annapurna',
      phone: '9000000003',
      role: 'STORE_MANAGER' as const,
      restaurantId: restaurants[1]._id,
    },
    { name: 'Ravi Kumar', phone: '9000000004', role: 'DELIVERY_AGENT' as const, restaurantId: null },
    { name: 'Suresh Yadav', phone: '9000000005', role: 'DELIVERY_AGENT' as const, restaurantId: null },
  ]

  console.log('\nusers')
  for (const u of users) {
    await User.findOneAndUpdate(
      { phone: u.phone },
      { $set: { ...u, passwordHash }, $setOnInsert: { active: true } },
      { upsert: true, returnDocument: 'after' },
    )
    const outlet = u.restaurantId
      ? restaurants.find((r) => r._id.equals(u.restaurantId!))!.name
      : '—'
    console.log(`  ✓ ${u.phone}  ${u.role.padEnd(15)} ${u.name.padEnd(20)} ${outlet}`)
  }

  console.log(`\nAll users share the password: ${env.SEED_PASSWORD}`)
  console.log('Log in with the PHONE number, not a name or email.')
  await disconnectDb()
}

main().catch((err) => {
  console.error('\nSeed FAILED:', err.message)
  process.exit(1)
})
