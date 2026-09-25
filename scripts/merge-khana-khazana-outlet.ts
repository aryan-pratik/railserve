/**
 * One-off: collapse the misspelt Gaya outlet into the correctly-named one.
 *
 * RailRestro addresses the kitchen as "KHANA KHAZANA" (see the parser's
 * sample). The outlet had been created as "KHAANA KHAJANA GAYA", and a
 * correctly-spelt outlet has since been added through the admin UI — leaving
 * two records for one kitchen, which matchOutlet would refuse to choose
 * between the moment both answer to the same name.
 *
 * Deleting the old record on its own would not just lose its history: its id
 * is referenced from three places, and a dangling reference in the third is
 * silent.
 *
 *   Order.restaurantId     orders disappear from the outlet's own screens
 *   PrintJob.restaurantId  queued tickets stop resolving
 *   User.restaurantIds     a STORE_MANAGER scoped to the dead id simply
 *                          stops seeing the outlet, with no error anywhere
 *
 * So every reference is repointed at the surviving outlet first, and only
 * then is the record removed. Nothing is orphaned.
 *
 * The old spellings are NOT carried over as aliases: every order on the old
 * record is MANUAL, so no parser has ever resolved an outlet by those names
 * and nothing in the ingest path depends on them.
 *
 * Prints what it would do and changes nothing unless --apply is passed.
 *
 *   npx tsx --env-file=.env.local scripts/merge-khana-khazana-outlet.ts
 *   npx tsx --env-file=.env.local scripts/merge-khana-khazana-outlet.ts --apply
 *
 * --create-target creates the surviving outlet if it does not exist yet,
 * for a database where it was never added through the UI.
 */
import { connectDb, disconnectDb } from '../src/lib/db'
import { Restaurant, Order, User, PrintJob } from '../src/lib/models'

/** Exactly as RailRestro's order mail spells it. */
const TARGET_NAME = 'KHANA KHAZANA'
const STATION = 'GAYA'
/** Both spellings of both words, so the misspelt record is found either way. */
const ANY_SPELLING = /kha[a]?na\s*kha[jz]ana/i

const apply = process.argv.includes('--apply')
const createTarget = process.argv.includes('--create-target')
const normalise = (s: string) => s.trim().toUpperCase().replace(/\s+/g, ' ')

async function main() {
  await connectDb()

  const candidates = await Restaurant.find({
    $or: [{ name: ANY_SPELLING }, { aliases: ANY_SPELLING }],
  })

  let target = candidates.find((r) => normalise(r.name) === TARGET_NAME) ?? null

  if (!target && createTarget) {
    if (apply) {
      target = await Restaurant.create({ name: TARGET_NAME, stationCode: STATION, active: true })
      console.log(`created outlet ${JSON.stringify(TARGET_NAME)} @${STATION}  _id=${target._id}`)
    } else {
      // Unsaved, purely so the dry run can print the rest of the plan. The
      // run returns before any write, so this never reaches the database.
      console.log(`would create outlet ${JSON.stringify(TARGET_NAME)} @${STATION}`)
      target = new Restaurant({ name: TARGET_NAME, stationCode: STATION, active: true })
    }
  }

  if (!target) {
    console.error(
      `No active outlet named ${JSON.stringify(TARGET_NAME)} in this database.\n` +
        `Add it through the admin UI first, or pass --create-target.`,
    )
    await disconnectDb()
    process.exit(1)
  }

  const doomed = candidates.filter((r) => String(r._id) !== String(target!._id))

  if (doomed.length === 0) {
    console.log(`Nothing to merge — ${JSON.stringify(target.name)} @${target.stationCode} is already the only one.`)
    await disconnectDb()
    return
  }

  if (doomed.length > 1) {
    console.error(`Found ${doomed.length} other outlets, refusing to guess which to delete:`)
    for (const r of doomed) console.error(`  - ${r._id} ${JSON.stringify(r.name)} @${r.stationCode}`)
    await disconnectDb()
    process.exit(1)
  }

  const old = doomed[0]

  // Moving orders between stations would change where food is expected to be
  // handed over. Not something a rename script gets to do.
  if (normalise(old.stationCode) !== normalise(target.stationCode)) {
    console.error(
      `${JSON.stringify(old.name)} is at ${old.stationCode} but ` +
        `${JSON.stringify(target.name)} is at ${target.stationCode}: refusing to merge across stations.`,
    )
    await disconnectDb()
    process.exit(1)
  }

  const orders = await Order.countDocuments({ restaurantId: old._id })
  const printJobs = await PrintJob.countDocuments({ restaurantId: old._id })
  const users = await User.find({ restaurantIds: old._id }).select('name phone role').lean()

  console.log(`${apply ? 'MERGING' : 'DRY RUN — would merge'}`)
  console.log(`  from  ${old._id} ${JSON.stringify(old.name)} @${old.stationCode} aliases=${JSON.stringify(old.aliases ?? [])}`)
  console.log(`  into  ${target._id} ${JSON.stringify(target.name)} @${target.stationCode}`)
  console.log(`  orders=${orders}  printJobs=${printJobs}  users=${users.length}`)
  for (const u of users) console.log(`      ${u.role} ${u.name} (${u.phone})`)

  if (!apply) {
    console.log('\nNothing changed. Re-run with --apply.')
    await disconnectDb()
    return
  }

  const o = await Order.updateMany({ restaurantId: old._id }, { $set: { restaurantId: target._id } })
  const p = await PrintJob.updateMany({ restaurantId: old._id }, { $set: { restaurantId: target._id } })
  // Two passes: MongoDB rejects $pull and $addToSet on one field in one update.
  const uAdd = await User.updateMany({ restaurantIds: old._id }, { $addToSet: { restaurantIds: target._id } })
  const uPull = await User.updateMany({ restaurantIds: old._id }, { $pull: { restaurantIds: old._id } })
  console.log(`  moved orders=${o.modifiedCount} printJobs=${p.modifiedCount} users=${uAdd.modifiedCount}/${uPull.modifiedCount}`)

  const remaining =
    (await Order.countDocuments({ restaurantId: old._id })) +
    (await PrintJob.countDocuments({ restaurantId: old._id })) +
    (await User.countDocuments({ restaurantIds: old._id }))
  if (remaining > 0) {
    console.error(`  ${remaining} references still point at ${old._id}. NOT deleting it.`)
    await disconnectDb()
    process.exit(1)
  }

  await Restaurant.deleteOne({ _id: old._id })
  console.log(`  deleted ${old._id} ${JSON.stringify(old.name)}`)

  const after = await Restaurant.find({ stationCode: STATION }).select('name aliases active').lean()
  console.log(`\n${STATION} outlets now:`)
  for (const r of after) console.log(`  ${r.active ? 'ACTIVE  ' : 'INACTIVE'} ${JSON.stringify(r.name)} aliases=${JSON.stringify(r.aliases ?? [])}`)

  await disconnectDb()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
