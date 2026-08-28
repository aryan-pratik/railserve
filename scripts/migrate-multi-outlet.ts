/**
 * One-shot migration: users.restaurantId (single) -> users.restaurantIds (array).
 *
 * A store manager commonly runs several outlets at one station, and the old
 * single-reference shape forced one login per outlet.
 *
 * Goes through the raw driver rather than the Mongoose model on purpose:
 * restaurantId is no longer in the schema, and with strictQuery on, Mongoose
 * strips it out of both the filter and the update — silently turning
 * "users that still have the old field" into "every user", and writing
 * [undefined] into the ones that never had an outlet. The raw collection has no
 * schema to strip anything.
 *
 * Idempotent: a user already holding restaurantIds keeps them, so re-running
 * after a partial failure is safe.
 *
 *   npm run migrate:multi-outlet
 */
import { ObjectId } from 'mongodb'
import { connectDb, disconnectDb } from '../src/lib/db'
import { User } from '../src/lib/models'

async function main() {
  await connectDb()
  const users = User.collection

  const legacy = await users.find({ restaurantId: { $exists: true } }).toArray()
  console.log(`found ${legacy.length} user(s) carrying the old restaurantId field`)

  let moved = 0
  let cleared = 0

  for (const u of legacy) {
    const old = u.restaurantId
    const existing = Array.isArray(u.restaurantIds) ? u.restaurantIds : []

    // Only a real reference becomes an outlet. A null restaurantId meant "this
    // user has no outlet" — an admin or a rider — and must stay empty.
    const next =
      existing.length > 0 ? existing : old instanceof ObjectId ? [old] : []

    await users.updateOne(
      { _id: u._id },
      { $set: { restaurantIds: next }, $unset: { restaurantId: '' } },
    )

    if (next.length > 0 && existing.length === 0) {
      moved += 1
      console.log(`  ✓ ${u.phone}  ${u.name}  ->  [${next.map(String).join(', ')}]`)
    } else {
      cleared += 1
    }
  }

  // Anyone who never had the field still needs the array to exist, or the login
  // guard reads .length off undefined.
  const backfilled = await users.updateMany(
    { restaurantIds: { $exists: false } },
    { $set: { restaurantIds: [] } },
  )

  console.log(
    `\nmoved ${moved}, left empty ${cleared}, backfilled ${backfilled.modifiedCount}`,
  )

  // Riders are scoped by outlet now too — nobody assigns them work, so an
  // outlet is the only thing that decides what a rider can see. A rider
  // carried over from the assignment model holds none, and their app will be
  // empty until an admin gives them one.
  for (const [role, consequence] of [
    ['STORE_MANAGER', 'will be refused at login'],
    ['DELIVERY_AGENT', 'will see an empty board'],
  ] as const) {
    const orphans = await users.countDocuments({ role, restaurantIds: { $size: 0 }, active: true })
    if (orphans > 0) {
      console.warn(
        `\n⚠  ${orphans} active ${role} account(s) hold no outlet and ${consequence}.\n` +
          '   Give them one in Admin -> Setup -> Staff.',
      )
    }
  }

  await disconnectDb()
}

main().catch((err) => {
  console.error('\nMigration FAILED:', err.message)
  process.exit(1)
})
