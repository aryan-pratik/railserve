/**
 * Builds the menu database from every order already received.
 *
 * Reads each order's items, and for every dish an aggregator has sent that
 * the menu does not have yet, adds a row with a suggested veg / non-veg tag
 * (lib/dietSuggest.ts), or with no tag when the name could be either. Every
 * new row is marked "needs check" on the Menu page, and prints on the KOT
 * with a "?", until an admin confirms it. Rows that already exist are never
 * touched, so a tag somebody set survives a re-run.
 *
 * Idempotent. Read-only without --apply:
 *   npm run menu:seed              (prints what it would add)
 *   npm run menu:seed -- --apply   (writes)
 */
import mongoose from 'mongoose'
import { connectDb, disconnectDb } from '../src/lib/db'
import { MenuItem, Order } from '../src/lib/models'
import { isMenuDish, menuKey, menuLookupKey, menuSource } from '../src/lib/diet'
import { suggestDiet } from '../src/lib/dietSuggest'
import { registerMenuItems } from '../src/lib/repo/menuRepo'
import { ORDER_SOURCES, sourceLabel } from '../src/lib/orderEnums'

const MARK = { VEG: '● veg     ', NON_VEG: '▲ non-veg ', none: '? no guess' } as const

async function main() {
  const apply = process.argv.includes('--apply')
  await connectDb()
  console.log(`Database: ${mongoose.connection.name}  (host ${mongoose.connection.host})`)

  // Newest first, so a row takes the spelling the aggregator uses today.
  const seen = await Order.aggregate<{ _id: { source: string; name: string; spec: string | null }; orders: number }>([
    { $match: { status: { $ne: 'RATING_ORDER' } } },
    { $sort: { createdAt: -1 } },
    { $project: { source: 1, items: 1 } },
    { $unwind: '$items' },
    { $match: { 'items.isPacking': { $ne: true } } },
    {
      $group: {
        _id: { source: '$source', name: '$items.name', spec: { $ifNull: ['$items.spec', null] } },
        orders: { $sum: 1 },
      },
    },
  ]).allowDiskUse(true)

  const existing = new Set((await MenuItem.find({}).select('_id').lean()).map((m) => m._id))
  const fresh = new Map<string, { source: string; name: string; orders: number }>()
  let composite = 0
  for (const s of seen) {
    if (typeof s._id.name !== 'string' || !menuKey(s._id.name)) continue
    // A bulk thali or any item whose food is in its spec is tagged on the
    // order itself, never through the menu (lib/diet.ts isMenuDish).
    if (!isMenuDish({ name: s._id.name, spec: s._id.spec })) {
      composite += s.orders
      continue
    }
    const id = menuLookupKey(s._id.source, s._id.name)
    if (existing.has(id)) continue
    const prev = fresh.get(id)
    if (prev) prev.orders += s.orders
    else fresh.set(id, { source: menuSource(s._id.source), name: s._id.name, orders: s.orders })
  }

  let noGuess = 0
  for (const source of ORDER_SOURCES) {
    const rows = [...fresh.values()].filter((r) => r.source === source).sort((a, b) => b.orders - a.orders)
    if (rows.length === 0) continue
    const guesses = rows.map((r) => suggestDiet(r.name))
    const count = (d: string | null) => guesses.filter((g) => g === d).length
    noGuess += count(null)
    console.log(
      `\n${sourceLabel(source)}: ${rows.length} new item(s): ` +
        `${count('VEG')} suggested veg, ${count('NON_VEG')} suggested non-veg, ${count(null)} with no guess`,
    )
    rows.forEach((r, i) => {
      console.log(`  ${MARK[guesses[i] ?? 'none']}  ${String(r.orders).padStart(5)}  ${r.name}`)
    })
  }

  console.log(`\n${existing.size} item(s) already on the menu, ${fresh.size} to add.`)
  if (noGuess > 0) {
    console.log(`${noGuess} of them get no suggestion (the name could be either). They print with a "?" until tagged.`)
  }
  if (composite > 0) {
    console.log(`${composite} bulk thali / composite line(s) skipped: those are tagged on the order itself.`)
  }
  if (!apply) {
    console.log('Nothing written. Re-run with --apply to add them.')
  } else {
    const added = await registerMenuItems([...fresh.values()])
    console.log(`Added ${added} item(s). Every one is unconfirmed: check them on /admin/menu (filter: Needs check).`)
  }
  await disconnectDb()
}

main().catch((err) => {
  console.error('\nMenu seed FAILED:', err.message)
  process.exit(1)
})
