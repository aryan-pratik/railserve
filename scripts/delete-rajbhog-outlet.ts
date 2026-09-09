/**
 * One-off: hard-delete the inactive "RAJBHOG" outlet (superseded by the
 * active "RajBhog Khana" outlet). Deliberately narrowed to inactive-only
 * matches so it can never touch RajBhog Khana.
 *
 * Refuses to run if the match isn't exactly one, or if any order still
 * references it (hard-deleting an outlet with order history makes those
 * orders invisible to every dashboard — see outletActions.ts).
 *
 *   npx tsx --env-file=.env.local scripts/check-rajbhog.ts        # dry run
 *   npx tsx --env-file=.env.local scripts/check-rajbhog.ts --delete
 */
import { connectDb, disconnectDb } from '../src/lib/db'
import { Restaurant, Order } from '../src/lib/models'

async function main() {
  const doDelete = process.argv.includes('--delete')

  await connectDb()

  const candidates = await Restaurant.find({
    active: false,
    $or: [{ name: /rajbhog/i }, { aliases: /rajbhog/i }],
  })

  if (candidates.length === 0) {
    console.error('No inactive outlet matching /rajbhog/i found. Nothing to do.')
    await disconnectDb()
    process.exit(1)
  }

  if (candidates.length > 1) {
    console.error(`Found ${candidates.length} inactive matches, refusing to guess:`)
    for (const r of candidates) console.error(`  - ${r._id} ${JSON.stringify(r.name)}`)
    await disconnectDb()
    process.exit(1)
  }

  const r = candidates[0]
  const orderCount = await Order.countDocuments({ restaurantId: r._id })

  console.log(`Match: ${r._id} name=${JSON.stringify(r.name)} aliases=${JSON.stringify(r.aliases)}`)
  console.log(`Orders referencing this outlet: ${orderCount}`)

  if (orderCount > 0) {
    console.error(`\nRefusing to delete: ${orderCount} order(s) reference this outlet.`)
    console.error('Deleting would make them invisible to every dashboard. Deactivate only, or reassign the orders first.')
    await disconnectDb()
    process.exit(1)
  }

  if (!doDelete) {
    console.log('\nDry run only. Re-run with --delete to actually remove it.')
    await disconnectDb()
    return
  }

  await Restaurant.deleteOne({ _id: r._id })
  console.log('\nDeleted.')
  await disconnectDb()
}

main().catch((err) => {
  console.error('\nFAILED:', err.message)
  process.exit(1)
})
