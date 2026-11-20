/**
 * Builds the menu database from every order already received.
 *
 * Reads each order's items, and for every dish an aggregator has sent that
 * the menu does not have yet, adds a row with a suggested veg / non-veg tag
 * (lib/diet.ts suggestDiet). Suggested rows are marked "needs check" on the
 * Menu page until an admin confirms them. Rows that already exist are never
 * touched, so a tag somebody set survives a re-run.
 *
 * Idempotent. Read-only without --apply:
 *   npm run menu:seed              (prints what it would add)
 *   npm run menu:seed -- --apply   (writes)
 */
import mongoose from 'mongoose'
import { connectDb, disconnectDb } from '../src/lib/db'
import { MenuItem, Order } from '../src/lib/models'
import { menuKey, suggestDiet } from '../src/lib/diet'
import { registerMenuItems } from '../src/lib/repo/menuRepo'
import { ORDER_SOURCES, sourceLabel } from '../src/lib/orderEnums'

async function main() {
  const apply = process.argv.includes('--apply')
  await connectDb()
  console.log(`Database: ${mongoose.connection.name}  (host ${mongoose.connection.host})`)

  // Newest first, so a row takes the spelling the aggregator uses today.
  const seen = await Order.aggregate<{ _id: { source: string; name: string }; orders: number }>([
    { $sort: { createdAt: -1 } },
    { $project: { source: 1, items: 1 } },
    { $unwind: '$items' },
    { $match: { 'items.isPacking': { $ne: true } } },
    { $group: { _id: { source: '$source', name: '$items.name' }, orders: { $sum: 1 } } },
  ]).allowDiskUse(true)

  const existing = new Set((await MenuItem.find({}).select('source key').lean()).map((m) => `${m.source}|${m.key}`))
  const fresh = new Map<string, { source: string; name: string; orders: number }>()
  for (const s of seen) {
    const key = menuKey(s._id.name)
    if (!key) continue
    const source = (ORDER_SOURCES as readonly string[]).includes(s._id.source) ? s._id.source : 'MANUAL'
    const id = `${source}|${key}`
    if (existing.has(id)) continue
    const prev = fresh.get(id)
    if (prev) prev.orders += s.orders
    else fresh.set(id, { source, name: s._id.name, orders: s.orders })
  }

  for (const source of ORDER_SOURCES) {
    const rows = [...fresh.values()].filter((r) => r.source === source).sort((a, b) => b.orders - a.orders)
    if (rows.length === 0) continue
    const nonVeg = rows.filter((r) => suggestDiet(r.name) === 'NON_VEG')
    console.log(`\n${sourceLabel(source)}: ${rows.length} new item(s), ${nonVeg.length} suggested non-veg`)
    for (const r of rows) {
      console.log(`  ${suggestDiet(r.name) === 'NON_VEG' ? '▲ non-veg' : '● veg    '}  ${String(r.orders).padStart(5)}  ${r.name}`)
    }
  }

  console.log(`\n${existing.size} item(s) already on the menu, ${fresh.size} to add.`)
  if (!apply) {
    console.log('Nothing written. Re-run with --apply to add them.')
  } else {
    const added = await registerMenuItems([...fresh.values()])
    console.log(`Added ${added} item(s). Check them on /admin/menu (filter: Needs check).`)
  }
  await disconnectDb()
}

main().catch((err) => {
  console.error('\nMenu seed FAILED:', err.message)
  process.exit(1)
})
