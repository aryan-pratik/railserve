/**
 * Generates (or rotates) the bearer token an outlet's print agent uses to
 * poll for jobs (Restaurant.printAgentToken — see agent/README.md).
 *
 *   npm run print-agent:token -- --restaurant <restaurantId>
 *   npm run print-agent:token -- --restaurant <restaurantId> --rotate
 *
 * Without --rotate, a restaurant that already has a token just has it
 * printed again — running this twice by habit shouldn't silently invalidate
 * an agent that's already deployed and working.
 */
import crypto from 'node:crypto'
import { connectDb, disconnectDb } from '../src/lib/db'
import { Restaurant } from '../src/lib/models'

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null
}

async function main() {
  const restaurantId = arg('--restaurant')
  const rotate = process.argv.includes('--rotate')

  if (!restaurantId) {
    console.error('Usage: npm run print-agent:token -- --restaurant <restaurantId> [--rotate]')
    process.exit(1)
  }

  await connectDb()
  const restaurant = await Restaurant.findById(restaurantId)
  if (!restaurant) {
    console.error(`No restaurant with id ${restaurantId}`)
    process.exit(1)
  }

  if (restaurant.printAgentToken && !rotate) {
    console.log(`${restaurant.name} already has a token (pass --rotate to replace it):`)
    console.log(restaurant.printAgentToken)
    await disconnectDb()
    return
  }

  const token = crypto.randomBytes(24).toString('base64url')
  restaurant.printAgentToken = token
  await restaurant.save()

  console.log(`AGENT_TOKEN for ${restaurant.name} (${restaurant._id}):`)
  console.log(token)
  console.log('\nPut this in agent/.env on that outlet\'s bridge device.')

  await disconnectDb()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
