/**
 * Converts orders in retired statuses by hand. The same conversion runs by
 * itself at every server start (src/instrumentation.ts); this is for a local
 * database that is not served.
 *
 *   npm run migrate:legacy-statuses
 */
import { disconnectDb } from '../src/lib/db'
import { cleanUpRetiredStatuses } from '../src/lib/repo/statusCleanup'

async function main() {
  const r = await cleanUpRetiredStatuses((line) => console.log(`~ ${line}`))
  console.log(`done: ${Object.values(r.converted).reduce((a, b) => a + b, 0)} converted, ${r.failed} failed`)
  await disconnectDb()
}

main().catch((err) => {
  console.error('\nMigration FAILED:', err.message)
  process.exit(1)
})
