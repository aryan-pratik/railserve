/**
 * One-off: rename the existing RajBhog outlet so the new RajBhog Khana
 * parser's fixed outletName ("RajBhog Khana") resolves via matchOutlet.
 * The old name is kept as an alias so whatever already matches it (the
 * other partner) is unaffected.
 *
 * Aborts without writing if it finds anything other than exactly one match.
 *
 *   npx tsx --env-file=.env.local scripts/fix-rajbhog-outlet.ts
 */
import { connectDb, disconnectDb } from '../src/lib/db'
import { Restaurant } from '../src/lib/models'

const NEW_NAME = 'RajBhog Khana'

async function main() {
  await connectDb()

  const candidates = await Restaurant.find({
    $or: [{ name: /rajbhog/i }, { aliases: /rajbhog/i }],
  })

  if (candidates.length === 0) {
    console.error('No outlet matching /rajbhog/i found. Nothing changed.')
    await disconnectDb()
    process.exit(1)
  }

  if (candidates.length > 1) {
    console.error(`Found ${candidates.length} matching outlets, refusing to guess:`)
    for (const r of candidates) {
      console.error(`  - ${r._id} ${JSON.stringify(r.name)} aliases=${JSON.stringify(r.aliases)}`)
    }
    await disconnectDb()
    process.exit(1)
  }

  const r = candidates[0]
  const oldName = r.name

  if (oldName.trim().toUpperCase() === NEW_NAME.toUpperCase()) {
    console.log(`Outlet ${r._id} is already named ${JSON.stringify(NEW_NAME)}. Nothing to do.`)
    await disconnectDb()
    return
  }

  const aliases = Array.from(new Set([...(r.aliases ?? []), oldName]))

  console.log(`Outlet ${r._id}`)
  console.log(`  name:    ${JSON.stringify(oldName)} -> ${JSON.stringify(NEW_NAME)}`)
  console.log(`  aliases: ${JSON.stringify(r.aliases)} -> ${JSON.stringify(aliases)}`)

  await Restaurant.updateOne({ _id: r._id }, { $set: { name: NEW_NAME, aliases } })

  console.log('\nDone.')
  await disconnectDb()
}

main().catch((err) => {
  console.error('\nFAILED:', err.message)
  process.exit(1)
})
