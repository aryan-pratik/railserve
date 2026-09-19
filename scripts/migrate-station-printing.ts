/**
 * One-shot migration: the print agent's identity moves from the outlet
 * (Restaurant.printAgentToken) to the station (Station.printAgentToken).
 *
 * A Restaurant is an aggregator brand, not a kitchen. Three brands trading at
 * Kanpur Central share one stove and one thermal printer, so the old shape
 * needed three agent processes pointed at the same device. A station owns the
 * printer; every brand's tickets come off it.
 *
 * The single most important thing this does is **adopt the live token**: the
 * existing outlet token is copied verbatim onto its station, so the agent
 * already running in a kitchen keeps working on its next poll with no edit to
 * its .env, no restart, and nobody visiting the outlet.
 *
 * Additive and safe to run against the OLD running app — it writes a
 * collection the old code has never heard of, adds a field the old schema's
 * `strict: true` makes invisible, and deliberately leaves
 * Restaurant.printAgentToken in place as the rollback path. Purge that later,
 * separately, once the new shape has proven itself.
 *
 * Idempotent: re-running adopts nothing already adopted and never rotates a
 * token out from under a live agent.
 *
 *   npm run migrate:station-printing
 */
import { connectDb, disconnectDb } from '../src/lib/db'
import { Restaurant, PrintJob, Station } from '../src/lib/models'
import { normaliseStationCode } from '../src/lib/stations'

export type StationMigrationReport = {
  stationsCreated: string[]
  tokensAdopted: string[]
  jobsBackfilled: number
  orphanJobs: number
  /** Things it refused to guess at. Each one needs a human. */
  warnings: string[]
}

/** The most frequent non-null value, ties broken by first occurrence. */
function commonest(values: string[]): string | null {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best: string | null = null
  let bestCount = 0
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value
      bestCount = count
    }
  }
  return best
}

export async function migrateStationPrinting(): Promise<StationMigrationReport> {
  const report: StationMigrationReport = {
    stationsCreated: [],
    tokensAdopted: [],
    jobsBackfilled: 0,
    orphanJobs: 0,
    warnings: [],
  }

  const outlets = await Restaurant.find({}).select('_id name stationCode stationName printAgentToken').lean()
  const codes = [...new Set(outlets.map((o) => normaliseStationCode(o.stationCode ?? '')).filter(Boolean))]

  for (const code of codes) {
    const atStation = outlets.filter((o) => normaliseStationCode(o.stationCode ?? '') === code)
    const names = atStation.map((o) => o.stationName).filter((n): n is string => Boolean(n))
    const withTokens = atStation.filter((o) => o.printAgentToken)

    // More than one outlet at a station holding a token means two agents were
    // configured for one kitchen. Picking one silently would 401 the other
    // agent with no explanation, so refuse — same stance as outletMatch.ts.
    if (withTokens.length > 1) {
      report.warnings.push(
        `${code}: ${withTokens.length} outlets hold agent tokens (${withTokens
          .map((o) => o.name)
          .join(', ')}) — refusing to guess which printer is live. ` +
          'Pick one in Admin → Setup → Printers.',
      )
    }
    if (new Set(names).size > 1) {
      report.warnings.push(
        `${code}: outlets disagree on the station name (${[...new Set(names)].join(' | ')}) — kept "${commonest(names)}".`,
      )
    }

    const existing = await Station.findById(code)
    if (!existing) {
      await Station.create({
        _id: code,
        name: commonest(names),
        printAgentToken: withTokens.length === 1 ? withTokens[0].printAgentToken : null,
        active: true,
      })
      report.stationsCreated.push(code)
      if (withTokens.length === 1) report.tokensAdopted.push(code)
    } else if (!existing.printAgentToken && withTokens.length === 1) {
      // Station already existed but had no agent — adopt the outlet's token.
      existing.printAgentToken = withTokens[0].printAgentToken
      await existing.save()
      report.tokensAdopted.push(code)
    }
  }

  // Backfill jobs queued under the old shape so nothing in flight is stranded.
  const codeByOutlet = new Map(outlets.map((o) => [String(o._id), normaliseStationCode(o.stationCode ?? '')]))
  const legacy = await PrintJob.collection.find({ stationCode: { $exists: false } }).toArray()

  for (const job of legacy) {
    const code = codeByOutlet.get(String(job.restaurantId))
    if (!code) {
      report.orphanJobs++
      continue
    }
    await PrintJob.collection.updateOne({ _id: job._id }, { $set: { stationCode: code } })
    report.jobsBackfilled++
  }

  return report
}

async function main() {
  await connectDb()
  const report = await migrateStationPrinting()

  for (const code of report.stationsCreated) console.log(`+ station ${code}`)
  for (const code of report.tokensAdopted) {
    console.log(`~ ${code}: adopted the live agent token — that kitchen needs no reconfiguration`)
  }
  console.log(`printjobs: ${report.jobsBackfilled} backfilled, ${report.orphanJobs} orphaned`)

  for (const w of report.warnings) console.warn(`\n⚠  ${w}`)

  const noToken = await Station.countDocuments({ printAgentToken: null, active: true })
  if (noToken > 0) {
    console.warn(
      `\n⚠  ${noToken} active station(s) have no agent token. Orders there will queue and never print.\n` +
        '   Mint one in Admin → Setup → Printers.',
    )
  }

  console.log('\nRestaurant.printAgentToken left in place on purpose — it is the rollback path.')
  await disconnectDb()
}

// Only when run directly, so importing this from a test does not connect.
if (process.argv[1]?.includes('migrate-station-printing')) {
  main().catch((err) => {
    console.error('\nMigration FAILED:', err.message)
    process.exit(1)
  })
}
