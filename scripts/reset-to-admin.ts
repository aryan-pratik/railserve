/**
 * Wipes every operational collection and leaves exactly one admin.
 *
 * For clearing out a round of manual testing. It empties the database the app
 * actually serves, so it refuses to run without --yes, prints what it is about
 * to destroy, and writes a JSON backup first — a wipe you cannot undo is a
 * wipe you eventually regret.
 *
 *   npm run reset:admin -- --yes
 *   npm run reset:admin -- --yes --phone 9821244895 --name Gautam
 *
 * Uses deleteMany rather than dropping collections: dropping takes the indexes
 * with it, and externalOrderId_unique is what makes email ingestion idempotent.
 */
import fs from 'node:fs'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import { connectDb, disconnectDb } from '../src/lib/db'
import { User } from '../src/lib/models'

const COLLECTIONS = [
  'orders',
  'users',
  'restaurants',
  'counters',
  'trainstatuses',
  'unparsedinboxes',
  'ingeststates',
]

function arg(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

async function main() {
  const confirmed = process.argv.includes('--yes')
  const name = arg('--name', 'Gautam')
  // Stored without spaces: login matches the phone exactly, so a stored space
  // would have to be typed every time.
  const phone = arg('--phone', '9821244895').replace(/\s+/g, '')
  const password = arg('--password', 'admin@123')

  const m = await connectDb()
  const db = m.connection.db!

  console.log(`database: ${m.connection.name}\n`)
  let total = 0
  for (const c of COLLECTIONS) {
    if (!(await db.listCollections({ name: c }).hasNext())) continue
    const n = await db.collection(c).countDocuments()
    total += n
    if (n > 0) console.log(`  ${c.padEnd(18)} ${String(n).padStart(4)} docs`)
  }

  if (!confirmed) {
    console.log(
      `\nWould delete ${total} document(s) and recreate a single admin.` +
        '\nRe-run with --yes to actually do it.',
    )
    await disconnectDb()
    return
  }

  const dir = path.join(process.cwd(), '.backups')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${m.connection.name}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  const dump: Record<string, unknown[]> = {}
  for (const c of COLLECTIONS) {
    if (!(await db.listCollections({ name: c }).hasNext())) continue
    dump[c] = await db.collection(c).find({}).toArray()
  }
  fs.writeFileSync(file, JSON.stringify(dump, null, 2))
  console.log(`\nbackup: ${path.relative(process.cwd(), file)}`)

  for (const c of COLLECTIONS) {
    if (!(await db.listCollections({ name: c }).hasNext())) continue
    const { deletedCount } = await db.collection(c).deleteMany({})
    if (deletedCount > 0) console.log(`  cleared ${c.padEnd(18)} ${deletedCount}`)
  }

  await User.create({
    name,
    phone,
    passwordHash: await bcrypt.hash(password, 10),
    role: 'ADMIN',
    restaurantIds: [],
    active: true,
  })

  // Verify the stored hash actually accepts the intended password, rather than
  // trusting that it was written correctly.
  const created = await User.findOne({ phone })
  const ok = created ? await bcrypt.compare(password, created.passwordHash) : false

  console.log(`\nadmin: ${name} — ${phone}`)
  console.log(`password verifies: ${ok}`)
  console.log(`users now: ${await db.collection('users').countDocuments()}`)
  console.log(`orders now: ${await db.collection('orders').countDocuments()}`)

  if (!ok) process.exitCode = 1
  await disconnectDb()
}

main().catch((err) => {
  console.error('\nFAILED:', err.message)
  process.exit(1)
})
