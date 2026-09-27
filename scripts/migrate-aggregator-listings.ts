/**
 * One-shot migration: aggregator storefronts stop being outlets.
 *
 * `restaurants` held two different things under one name — our kitchens
 * (Hotel Ganga Galaxy, The Cosmozin Lounge) and the names those kitchens trade
 * under on each aggregator ("YATRI BHOJAN", "RajBhog Khana", "OLF"). Kanpur
 * Central therefore had seven "outlets" for two stoves, every member of staff
 * had to be assigned all seven to see one kitchen's work, and adding an
 * aggregator meant editing every user.
 *
 * This keeps the real outlets, turns the rest into `Listing` rows pointing at
 * the outlet that actually cooks for them, repoints their orders, and remaps
 * staff. The aggregator itself is untouched: it always lived on `Order.source`.
 *
 * WHICH ROWS ARE REAL is not guessable, so it is not guessed — pass them:
 *
 *   npm run migrate:listings -- --outlets "HOTEL GANGA GALAXY,THE COSMOZIN LOUNGE,KHANA KHAZANA,BITE STATION" \
 *                               --default "CNB=HOTEL GANGA GALAXY,GAYA=KHANA KHAZANA"
 *
 * Add --apply to write; without it this is a dry run that prints the plan and
 * changes nothing. Inactive rows are left exactly where they are.
 *
 * Idempotent: a storefront already migrated has no orders left pointing at its
 * old row, and re-running re-creates nothing.
 *
 * RUN `migrate:station-printing` FIRST. A station's print-agent token can sit
 * on a storefront row — CNB's is on "YATRI BHOJAN" — and this deactivates
 * those rows. Station-printing only adopts tokens from ACTIVE outlets, so
 * running it afterwards finds none, leaves the station with a null token, and
 * the kitchen's agent goes on 401ing with nothing to say why. The check below
 * refuses rather than letting that happen quietly.
 */
import mongoose from 'mongoose'
import { connectDb, disconnectDb } from '../src/lib/db'
import { Listing, Restaurant, Station, User } from '../src/lib/models'
import { __unsafeOrderModel as Order } from '../src/lib/repo/orderRepo'
import { normaliseStationCode } from '../src/lib/stations'
import type { OrderSource } from '../src/lib/orderEnums'

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null
}

const APPLY = process.argv.includes('--apply')
const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, ' ')

async function main() {
  const realNames = (arg('--outlets') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (realNames.length === 0) {
    throw new Error('--outlets is required: the comma-separated names of the REAL kitchens')
  }
  const realSet = new Set(realNames.map(norm))

  const defaults = new Map<string, string>()
  for (const pair of (arg('--default') ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const [code, name] = pair.split('=')
    if (code && name) defaults.set(normaliseStationCode(code), norm(name))
  }

  await connectDb()
  console.log(`Database: ${mongoose.connection.name}  (host ${mongoose.connection.host})`)
  console.log(APPLY ? 'MODE: APPLY — writing changes\n' : 'MODE: DRY RUN — nothing will be written\n')

  const all = await Restaurant.find({}).lean()
  const byId = new Map(all.map((r) => [String(r._id), r]))

  // Only active rows are reclassified. A deactivated row is already out of the
  // way: nothing matches it, nothing routes to it, and rewriting it would just
  // churn history.
  const active = all.filter((r) => r.active !== false)
  const unknown = realNames.filter((n) => !active.some((r) => norm(r.name) === norm(n)))
  if (unknown.length > 0) throw new Error(`--outlets names no active outlet: ${unknown.join(', ')}`)

  const outlets = active.filter((r) => realSet.has(norm(r.name)))
  const storefronts = active.filter((r) => !realSet.has(norm(r.name)))

  // Deactivating a storefront that still holds the only live print token for
  // its station would strand that kitchen's agent — see the header.
  for (const row of storefronts) {
    if (!row.printAgentToken) continue
    const code = normaliseStationCode(row.stationCode)
    const station = await Station.findById(code).select('printAgentToken').lean()
    if (!station?.printAgentToken) {
      throw new Error(
        `${row.name} (${code}) still holds this station's print-agent token, and ${code} has ` +
          'none of its own yet. Run `npm run migrate:station-printing` first, or this would ' +
          "silently stop that kitchen's printer.",
      )
    }
  }

  // --- station defaults ----------------------------------------------------
  // Written first: everything below falls back to them.
  for (const [code, name] of defaults) {
    const target = outlets.find((r) => norm(r.name) === name && normaliseStationCode(r.stationCode) === code)
    if (!target) throw new Error(`--default ${code}=${name}: no such active outlet at ${code}`)
    console.log(`default outlet  ${code} -> ${target.name}`)
    if (APPLY) {
      await Station.updateOne(
        { _id: code },
        { $set: { defaultRestaurantId: target._id }, $setOnInsert: { active: true } },
        { upsert: true },
      )
    }
  }
  console.log()

  // --- storefront rows become listings ------------------------------------
  for (const row of storefronts) {
    const code = normaliseStationCode(row.stationCode)
    const orders = await Order.countDocuments({ restaurantId: row._id })

    // Which outlet cooks it: the station's default, since that is the only
    // answer available without a human. Admin remaps in Setup afterwards.
    const targetName = defaults.get(code)
    const target = targetName
      ? outlets.find((r) => norm(r.name) === targetName && normaliseStationCode(r.stationCode) === code)
      : outlets.find((r) => normaliseStationCode(r.stationCode) === code)

    if (!target) {
      console.warn(`⚠  ${row.name} (${code}): no outlet at this station — left alone, ${orders} order(s) untouched`)
      continue
    }

    // The aggregator, when the row's own orders agree on one. Provenance for
    // the admin screen; never used for routing.
    const sources = await Order.distinct('source', { restaurantId: row._id })
    const source = sources.length === 1 ? (sources[0] as OrderSource) : null

    console.log(
      `listing         ${String(row.name).padEnd(22)} ${code} -> ${target.name}` +
        `  (${orders} order(s)${source ? `, ${source}` : ''})`,
    )

    if (APPLY) {
      const existing = await Listing.findOne({ name: row.name, stationCode: code })
      if (!existing) {
        await Listing.create({
          name: row.name,
          aliases: row.aliases ?? [],
          source,
          stationCode: code,
          restaurantId: target._id,
          active: true,
        })
      }
      if (orders > 0) {
        await Order.updateMany({ restaurantId: row._id }, { $set: { restaurantId: target._id } })
      }
      // Retired, not deleted: order history and the print-token rollback path
      // both still point here.
      await Restaurant.updateOne({ _id: row._id }, { $set: { active: false } })
    }
  }

  // --- staff --------------------------------------------------------------
  // Everyone scoped to a storefront row is rescoped to the kitchen behind it.
  console.log()
  const staff = await User.find({ restaurantIds: { $exists: true, $ne: [] } }).select('name role restaurantIds').lean()
  const storefrontIds = new Set(storefronts.map((r) => String(r._id)))

  // Rows deactivated before today, holding no orders, are dead weight in a
  // user's scope: nothing routes to them and nothing is filed under them, so
  // keeping them only pads the staff form with names nobody recognises. One
  // that still has orders stays, or the person loses sight of that history.
  const deadIds = new Set<string>()
  for (const row of all) {
    if (row.active !== false || realSet.has(norm(row.name))) continue
    if ((await Order.countDocuments({ restaurantId: row._id })) === 0) deadIds.add(String(row._id))
  }

  for (const user of staff) {
    const before = (user.restaurantIds ?? []).map(String)
    const after = new Set<string>()
    for (const id of before) {
      if (!storefrontIds.has(id)) {
        if (byId.has(id) && !deadIds.has(id)) after.add(id)
        continue
      }
      const code = normaliseStationCode(byId.get(id)?.stationCode ?? '')
      const targetName = defaults.get(code)
      const target = targetName
        ? outlets.find((r) => norm(r.name) === targetName && normaliseStationCode(r.stationCode) === code)
        : outlets.find((r) => normaliseStationCode(r.stationCode) === code)
      if (target) after.add(String(target._id))
    }

    const next = [...after]
    if (next.length === before.length && next.every((id) => before.includes(id))) continue

    console.log(`staff           ${String(user.name).padEnd(20)} ${before.length} -> ${next.length} outlet(s)`)
    if (APPLY) {
      await User.updateOne(
        { _id: user._id },
        { $set: { restaurantIds: next.map((id) => new mongoose.Types.ObjectId(id)) } },
      )
    }
  }

  console.log(`\n${APPLY ? 'Done.' : 'Dry run complete — re-run with --apply to write.'}`)
  await disconnectDb()
}

main().catch(async (err) => {
  console.error('\nMigration FAILED:', err instanceof Error ? err.message : err)
  process.exit(1)
})
