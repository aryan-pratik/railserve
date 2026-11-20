/**
 * Takes apart order items that hold more than one dish in their name:
 *
 *   "Veg Mini Thali, 2x Plain Tawa Roti"  ->  Veg Mini Thali  +  2 x Plain Tawa Roti
 *
 * New orders are split as they arrive (lib/splitItems.ts). This does the same
 * for orders already in the database, so the Menu page counts each dish under
 * its own name, then takes the combined rows off the menu.
 *
 * On each order the first dish keeps the item as it was: its quantity, price
 * and note. Nothing else on the order changes, and its "last updated" time is
 * kept. The original line stays in the order's raw payload.
 *
 * On the menu, a combined row is marked deleted (not dropped), and only once
 * no order carries its name. A dish that was confirmed veg as part of a
 * combined row is confirmed veg on its own row too; a non-veg row says only
 * that one of its dishes is non-veg, so those are left to be checked.
 *
 * Idempotent. Read-only without --apply:
 *   npm run menu:split              (prints what it would change)
 *   npm run menu:split -- --apply   (writes)
 */
import mongoose from 'mongoose'
import { connectDb, disconnectDb } from '../src/lib/db'
import { MenuItem, Order } from '../src/lib/models'
import { menuLookupKey } from '../src/lib/diet'
import { isCombinedName, splitCombinedItems, splitCombinedName } from '../src/lib/splitItems'
import { registerMenuItems } from '../src/lib/repo/menuRepo'

async function main() {
  const apply = process.argv.includes('--apply')
  await connectDb()
  console.log(`Database: ${mongoose.connection.name}  (host ${mongoose.connection.host})`)

  // A loose first cut that cannot miss; splitCombinedItems is what decides.
  const candidates = await Order.find({ 'items.name': /[,;]/ })
    .select('externalOrderId source items updatedAt')
    .lean()

  let orders = 0
  let failed = 0
  // Combined names on orders that could not be changed: their menu rows stay.
  const stillCarried = new Set<string>()
  for (const o of candidates) {
    const items = o.items ?? []
    const next = splitCombinedItems(items)
    if (next.length === items.length) continue
    orders += 1
    const added = next.filter((i) => !items.includes(i as (typeof items)[number]))
    console.log(`\n${o.source}  ${o.externalOrderId}`)
    for (const i of items) if (!next.includes(i)) console.log(`  was : ${i.qty} x ${i.name}`)
    for (const i of added) console.log(`  now : ${i.qty} x ${i.name}`)
    if (!apply) continue

    // Only if the order has not changed since it was read here.
    const res = await Order.updateOne({ _id: o._id, updatedAt: o.updatedAt }, { $set: { items: next } }, { timestamps: false })
    if (res.modifiedCount !== 1) {
      failed += 1
      for (const i of items) if (!next.includes(i)) stillCarried.add(menuLookupKey(o.source, i.name))
      console.log('  NOT changed: the order was edited meanwhile. Run again.')
      continue
    }
    // Rows for the dishes that now stand alone. A dish somebody deleted from
    // the Menu page is not put back by an old order.
    await registerMenuItems(added.map((i) => ({ source: o.source, name: i.name })), { restore: false })
  }

  const rows = (await MenuItem.find({ removedAt: null }).select('name source diet reviewed').lean()).filter(
    (r) => isCombinedName(r.name) && !stillCarried.has(r._id),
  )
  console.log(`\nMenu rows with a combined name: ${rows.length}`)
  for (const r of rows) {
    const carry = r.diet === 'VEG' && r.reviewed
    console.log(`  ${r.source}  ${r.name}${carry ? '   (confirmed veg: carried to each dish)' : ''}`)
  }
  if (apply && rows.length > 0) {
    for (const r of rows) {
      if (r.diet !== 'VEG' || !r.reviewed) continue
      const { first, rest } = splitCombinedName(r.name)
      const ids = [first, ...rest.map((p) => p.name)].map((n) => menuLookupKey(r.source, n))
      // Only rows nobody has confirmed yet: a person's own tag stands.
      await MenuItem.updateMany({ _id: { $in: ids }, reviewed: false }, { $set: { diet: 'VEG', reviewed: true, reviewedAt: new Date() } })
    }
    const res = await MenuItem.updateMany({ _id: { $in: rows.map((r) => r._id) } }, { $set: { removedAt: new Date() } })
    console.log(`Took ${res.modifiedCount} combined row${res.modifiedCount === 1 ? '' : 's'} off the menu.`)
  }

  const done = orders - failed
  console.log(
    apply
      ? `\nSplit ${done} order${done === 1 ? '' : 's'}.${failed ? ` ${failed} not changed: run again.` : ''}`
      : `\n${orders} order${orders === 1 ? '' : 's'} would be split. Nothing written. Add -- --apply to write.`,
  )
  await disconnectDb()
}

main().catch((err) => {
  console.error('\nSplit FAILED:', err.message)
  process.exit(1)
})
