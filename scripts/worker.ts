/**
 * Background worker. Run alongside `npm run dev`:
 *
 *   npm run worker
 *
 * Owns the repeating jobs from plan §2: train-status polling (§8) and, once
 * Gmail ingestion is wired, the daily watch renewal (§6). These must run with
 * no browser open — a leave-now alert that only fires while someone is looking
 * at a screen is not an alert.
 */
import { Queue, Worker, type Job } from 'bullmq'
import { createRedisConnection, QUEUE_NAMES } from '../src/lib/queue/connection'
import { pruneOldTrainStatuses, runTrainPollingTick } from '../src/lib/queue/trainPolling'
import { connectDb, disconnectDb } from '../src/lib/db'
import { isSimulatedProvider } from '../src/lib/train'
import { isGmailConfigured } from '../src/lib/ingest/gmail/client'
import { checkIngestStaleness, renewGmailWatch } from '../src/lib/ingest/gmail/sync'

const TICK_JOB = 'tick'
const PRUNE_JOB = 'prune'

async function main() {
  await connectDb()

  const connection = createRedisConnection()
  const queue = new Queue(QUEUE_NAMES.trainPolling, { connection })

  // A fixed one-minute tick; the per-train tier decides what actually gets
  // refreshed. See the note in trainPolling.ts for why this beats rescheduling
  // a repeatable job per train as its tier changes.
  await queue.upsertJobScheduler(
    'train-poll-every-minute',
    { every: 60_000 },
    { name: TICK_JOB, opts: { removeOnComplete: 50, removeOnFail: 50 } },
  )
  await queue.upsertJobScheduler(
    'train-status-prune-daily',
    { every: 24 * 60 * 60 * 1000 },
    { name: PRUNE_JOB, opts: { removeOnComplete: 5, removeOnFail: 5 } },
  )

  // --- Gmail watch renewal + staleness alert (plan §6, §13.4) ------------
  const gmailQueue = new Queue(QUEUE_NAMES.gmailWatch, { connection })
  if (isGmailConfigured()) {
    // Watch dies after 7 days; renew daily so a single missed run is survivable.
    await gmailQueue.upsertJobScheduler(
      'gmail-watch-renew-daily',
      { every: 24 * 60 * 60 * 1000 },
      { name: 'renew', opts: { removeOnComplete: 5, removeOnFail: 20 } },
    )
    await gmailQueue.upsertJobScheduler(
      'gmail-staleness-check',
      { every: 30 * 60 * 1000 },
      { name: 'staleness', opts: { removeOnComplete: 5, removeOnFail: 20 } },
    )
  }

  const gmailWorker = new Worker(
    QUEUE_NAMES.gmailWatch,
    async (job: Job) => {
      if (job.name === 'renew') {
        const r = await renewGmailWatch()
        console.log(`[gmail] watch renewed, expires ${r.expiresAt?.toISOString() ?? 'unknown'}`)
        return r
      }
      const s = await checkIngestStaleness()
      if (s.stale) {
        // Plan §6 asks for an alert. With no paging integration configured this
        // is a loud log line, which is at least visible in the worker output.
        console.warn(`[gmail] ⚠️  INGESTION MAY BE STALLED — ${s.message}`)
      }
      return s
    },
    { connection, concurrency: 1 },
  )

  gmailWorker.on('failed', (job, err) => {
    console.error(`[gmail] job ${job?.name} failed:`, err.message)
  })

  const worker = new Worker(
    QUEUE_NAMES.trainPolling,
    async (job: Job) => {
      if (job.name === PRUNE_JOB) {
        const removed = await pruneOldTrainStatuses()
        return { removed }
      }

      const summary = await runTrainPollingTick()
      if (summary.trainsConsidered > 0) {
        const bits = [
          `${summary.trainsConsidered} train(s)`,
          `${summary.refreshed} refreshed`,
          `${summary.skippedFresh} still fresh`,
        ]
        if (summary.failures) bits.push(`${summary.failures} FAILED`)
        console.log(`[train-poll] ${bits.join(' · ')}`)
        for (const fired of summary.leaveNowFired) {
          console.log(`[leave-now] ${fired}`)
        }
      }
      return summary
    },
    { connection, concurrency: 1 },
  )

  worker.on('failed', (job, err) => {
    // A provider outage must never take the worker down (plan §13.6).
    console.error(`[worker] job ${job?.name} failed:`, err.message)
  })

  console.log('Worker running.')
  console.log(`  train status provider : ${isSimulatedProvider() ? 'SIMULATOR (no TRAIN_API_KEY set)' : 'live upstream'}`)
  console.log('  train polling         : every 60s, tiered per train (10/5/2 min)')
  console.log('  cache prune           : daily')
  console.log(
    `  gmail ingestion       : ${
      isGmailConfigured()
        ? 'watch renewal daily, staleness check every 30m'
        : 'OFF (no credentials) — paste emails at /admin/inbox'
    }`,
  )
  console.log('\nCtrl-C to stop.')

  const shutdown = async () => {
    console.log('\nShutting down…')
    await worker.close()
    await gmailWorker.close()
    await queue.close()
    await gmailQueue.close()
    await connection.quit()
    await disconnectDb()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('Worker failed to start:', err)
  process.exit(1)
})
