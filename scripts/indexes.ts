/**
 * Creates every index explicitly (the specs live in src/lib/indexes.ts and also
 * run at boot). Idempotent:
 *   npm run indexes
 */
import mongoose from 'mongoose'
import { connectDb, disconnectDb } from '../src/lib/db'
import { ensureIndexes } from '../src/lib/indexes'
import { Tenant } from '../src/lib/models'

async function main() {
  await connectDb()
  console.log(`Database: ${mongoose.connection.name}  (host ${mongoose.connection.host})`)
  const multiTenant = (await Tenant.countDocuments({})) > 1
  await ensureIndexes({ multiTenant, log: (line) => console.log(`  ✓ ${line}`) })
  console.log('\nAll indexes created.')
  await disconnectDb()
}

main().catch((err) => {
  console.error('\nIndex creation FAILED:', err.message)
  process.exit(1)
})
