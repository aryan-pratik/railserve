/**
 * Registers (or inspects) the Gmail push watch.
 *
 * Push is the difference between an order email reaching the database in a
 * second and reaching it on the next tick of a one-minute poll. The transport
 * is Gmail -> Pub/Sub -> /api/gmail/webhook -> history.list, and this script
 * is the `users.watch()` call that starts it.
 *
 * Run it once by hand to turn push on and confirm it took. After that the
 * daily /api/cron/gmail-watch schedule keeps it alive — a watch lapses after
 * 7 days and takes ingestion with it, silently.
 *
 *   npm run gmail:watch          # show current state
 *   npm run gmail:watch -- --renew
 */
import mongoose from 'mongoose'
import { connectDb, disconnectDb } from '../src/lib/db'
import { GMAIL_STATE_ID, IngestState } from '../src/lib/models'
import { isGmailConfigured } from '../src/lib/ingest/gmail/client'
import { checkIngestStaleness, renewGmailWatch } from '../src/lib/ingest/gmail/sync'
import { env } from '../src/lib/env'

const RENEW = process.argv.includes('--renew')

function hours(from: Date | null | undefined): string {
  if (!from) return 'never'
  const h = (from.getTime() - Date.now()) / 3_600_000
  return h > 0 ? `in ${h.toFixed(1)}h` : `${Math.abs(h).toFixed(1)}h ago`
}

async function main() {
  await connectDb()
  console.log(`Database: ${mongoose.connection.name}\n`)

  if (!isGmailConfigured()) {
    console.log('Gmail is not configured — set GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN.')
    console.log('Run: npm run gmail:setup')
    await disconnectDb()
    return
  }

  if (!env.GMAIL_TOPIC_NAME) {
    console.log(`GMAIL_TOPIC_NAME is not set, so push is off and ingestion runs on the
one-minute poll. To turn push on, in the SAME Google Cloud project as the
OAuth client:

  1. Enable Pub/Sub:
     https://console.cloud.google.com/apis/library/pubsub.googleapis.com
  2. Create a topic, e.g. "gmail-ingest".
  3. On that topic, grant the Publisher role to Gmail's own service account:
       gmail-api-push@system.gserviceaccount.com
     Gmail cannot publish to the topic without this, and users.watch() fails
     with a permission error that names the topic rather than the grant.
  4. Create a PUSH subscription on the topic with endpoint:
       https://railserve.vercel.app/api/gmail/webhook?token=<GMAIL_WEBHOOK_TOKEN>
     Set its acknowledgement deadline to 60s — the webhook runs a full
     history sync before answering, and a 10s default will retry underneath it.
  5. Set in .env.local and in Vercel:
       GMAIL_TOPIC_NAME=projects/<project-id>/topics/gmail-ingest
       GMAIL_WEBHOOK_TOKEN=<any long random string, matching step 4>

Then re-run: npm run gmail:watch -- --renew`)
    await disconnectDb()
    return
  }

  if (RENEW) {
    console.log(`Registering watch on ${env.GMAIL_TOPIC_NAME} ...`)
    const { expiresAt, historyId } = await renewGmailWatch()
    console.log(`  ✓ expires ${expiresAt?.toISOString() ?? 'unknown'} (${hours(expiresAt)})`)
    console.log(`  ✓ historyId ${historyId ?? 'unchanged'}\n`)
  }

  const state = await IngestState.findOne({ _id: GMAIL_STATE_ID }).lean()
  const health = await checkIngestStaleness()

  console.log('Ingest state')
  console.log(`  topic          ${env.GMAIL_TOPIC_NAME}`)
  console.log(`  watch expires  ${state?.watchExpiresAt?.toISOString() ?? '—'}  (${hours(state?.watchExpiresAt)})`)
  console.log(`  last renewal   ${state?.lastWatchRenewalAt?.toISOString() ?? '—'}`)
  console.log(`  last message   ${state?.lastMessageAt?.toISOString() ?? '—'}`)
  console.log(`  historyId      ${state?.historyId ?? '—'}`)
  console.log(`  last error     ${state?.lastError ?? 'none'}`)
  console.log(`\nHealth: ${health.stale ? `STALE — ${health.message}` : 'ok'}`)

  if (!RENEW && !state?.watchExpiresAt) {
    console.log('\nNo watch registered yet. Run: npm run gmail:watch -- --renew')
  }

  await disconnectDb()
}

main().catch((err) => {
  console.error('\nFAILED:', err instanceof Error ? err.message : err)
  process.exit(1)
})
