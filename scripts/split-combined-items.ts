/**
 * Takes apart order items that hold more than one dish in their name:
 *
 *   "Veg Mini Thali, 2x Plain Tawa Roti"  ->  Veg Mini Thali  +  2 x Plain Tawa Roti
 *
 * New orders are split as they arrive (lib/splitItems.ts). This does the same
 * for orders already in the database, so the Menu page counts each dish under
 * its own name, then drops the combined rows from the menu.
 *
 * The first dish keeps the item as it was: its quantity, price, note and tag.
 * Nothing else on the order changes, and its "last updated" time is kept.
 *
 * Idempotent. Read-only without --apply:
 *   npm run menu:split              (prints what it would change)
 *   npm run menu:split -- --apply   (writes)
 */
import mongoose from 'mongoose'
import { connectDb, disconnectDb } from '../src/lib/db'
import { MenuItem, Order } from '../src/lib/models'
import { isCombinedName, splitCombinedItems } from '../src/lib/splitItems'
import { menuRowsOf, registerMenuItems } from '../src/lib/repo/menuRepo'

async function main() {
  const apply = process.argv.includes('--apply')
  await connectDb()
  console.log(`Database: ${mongoose.connection.name}  (host ${mongoose.connection.host})`)

  // A comma, then a number and an x: narrow enough to be worth reading each
  // match in full. isCombinedName below is what decides.
  const candidates = await Order.find({ 'items.name': /[,;]\s*\d{1,3}\s*[x×]\s/i })
    .select('externalOrderId source items updatedAt')
    .lean()

  let orders = 0
  let failed = 0
  for (const o of candidates) {
    const items = o.items ?? []
    const next = splitCombinedItems(items)
    if (next.length === items.length) continue
    orders += 1
    console.log(`\n${o.source}  ${o.externalOrderId}`)
    for (const i of items) {
      if (isCombinedName(i.name) && !i.isPacking && !(i.spec ?? '').trim()) console.log(`  was : ${i.qty} x ${i.name}`)
    }
    for (const i of next) {
      if (!items.includes(i as (typeof items)[number])) console.log(`  now : ${i.qty} x ${i.name}`)
    }
    if (!apply) continue

    // Only if the order has not changed since it was read here.
    const res = await Order.updateOne(
      { _id: o._id, updatedAt: o.updatedAt },
      { $set: { items: next } },
      { timestamps: false },
    )
    if (res.modifiedCount !== 1) {
      failed += 1
      console.log('  NOT changed: the order was edited meanwhile. Run again.')
      continue
    }
    await registerMenuItems(menuRowsOf({ source: o.source, items: next as Parameters<typeof menuRowsOf>[0]['items'] }))
  }

  // Menu rows that are a combined name. Once no order carries the name the
  // row is dead weight; before that, the Menu page would only add it back.
  const rows = (await MenuItem.find({}).select('name source').lean()).filter((r) => isCombinedName(r.name))
  console.log(`\nMenu rows with a combined name: ${rows.length}`)
  for (const r of rows) console.log(`  ${r.source}  ${r.name}`)
  if (apply && rows.length > 0 && failed === 0) {
    const res = await MenuItem.deleteMany({ _id: { $in: rows.map((r) => r._id) } })
    console.log(`Removed ${res.deletedCount} menu row${res.deletedCount === 1 ? '' : 's'}.`)
  }

  console.log(
    apply
      ? `\nSplit ${orders - failed} order${orders - failed === 1 ? '' : 's'}.${failed ? ` ${failed} not changed: run again.` : ''}`
      : `\n${orders} order${orders === 1 ? '' : 's'} would be split. Nothing written. Add -- --apply to write.`,
  )
  await disconnectDb()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
