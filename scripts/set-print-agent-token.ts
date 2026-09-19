/**
 * Generates (or rotates) the bearer token a station's print agent uses to
 * poll for jobs (Station.printAgentToken — see agent/README.md).
 *
 * Per station, not per outlet: one station is one kitchen is one printer,
 * however many aggregator brands trade there.
 *
 *   npm run print-agent:token -- --station CNB
 *   npm run print-agent:token -- --station CNB --rotate
 *
 * Without --rotate, a station that already has a token just has it printed
 * again — running this twice by habit shouldn't silently invalidate an agent
 * that's already deployed and working.
 */
import crypto from 'node:crypto'
import { connectDb, disconnectDb } from '../src/lib/db'
import { Station } from '../src/lib/models'
import { normaliseStationCode } from '../src/lib/stations'

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null
}

async function main() {
  const stationArg = arg('--station')
  const rotate = process.argv.includes('--rotate')

  if (!stationArg) {
    console.error('Usage: npm run print-agent:token -- --station <CODE> [--rotate]')
    process.exit(1)
  }

  await connectDb()
  const code = normaliseStationCode(stationArg)
  const station = await Station.findById(code)
  if (!station) {
    console.error(
      `No station ${code}. Stations are created from their outlets — run ` +
        '`npm run migrate:station-printing`, or add an outlet there first.',
    )
    process.exit(1)
  }

  if (station.printAgentToken && !rotate) {
    console.log(`${code} already has a token (pass --rotate to replace it):`)
    console.log(station.printAgentToken)
    await disconnectDb()
    return
  }

  if (station.printAgentToken && rotate) {
    console.warn(
      `\n⚠  Rotating ${code}'s token stops that kitchen printing until somebody\n` +
        "   edits agent/.env on the device there and restarts the agent.\n",
    )
  }

  const token = crypto.randomBytes(24).toString('base64url')
  station.printAgentToken = token
  await station.save()

  console.log(`AGENT_TOKEN for ${station.name ?? code} (${code}):`)
  console.log(token)
  console.log("\nPut this in agent/.env on that station's bridge device.")

  await disconnectDb()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
