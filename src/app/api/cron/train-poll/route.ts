import { NextResponse } from 'next/server'
import { runTrainPollingTick, pruneOldTrainStatuses, type PollSummary } from '@/lib/queue/trainPolling'
import { cronAuthFailure } from '@/lib/cronAuth'
import { connectDb } from '@/lib/db'
import { Tenant } from '@/lib/models'

export const dynamic = 'force-dynamic'

/**
 * Refreshes live train status for today's active trains, and fires the
 * leave-now event for runs whose food must go to the platform.
 *
 * This replaces the BullMQ worker. The polling logic never needed a queue — it
 * needed a clock — and running Redis plus a second long-lived process to supply
 * one is a lot of moving parts for a tick. Anything that can make an HTTPS
 * request on a schedule now works: a cloud scheduler, a GitHub Action, or a
 * cron line with curl.
 *
 * Without something calling this, the app still runs: train status refreshes
 * whenever a page asks for it, and only the leave-now alert — which has to fire
 * with no browser open — is lost.
 *
 * Protected by CRON_TOKEN when one is set. It is a cheap endpoint, but it does
 * hit the upstream train API, so it should not be free for anyone to spin.
 *
 * One tick covers every active tenant's trains, one tenant at a time, and
 * reports the sum.
 */
async function handle(request: Request) {
  const failure = cronAuthFailure(request)
  if (failure) return NextResponse.json({ error: failure }, { status: 401 })

  const prune = new URL(request.url).searchParams.get('prune') === '1'

  try {
    await connectDb()
    const tenants = await Tenant.find({ status: 'ACTIVE' }).select('_id').lean()
    const now = new Date()
    const summary: PollSummary = { trainsConsidered: 0, refreshed: 0, skippedFresh: 0, failures: 0, leaveNowFired: [] }
    for (const t of tenants) {
      const s = await runTrainPollingTick(t._id, now)
      summary.trainsConsidered += s.trainsConsidered
      summary.refreshed += s.refreshed
      summary.skippedFresh += s.skippedFresh
      summary.failures += s.failures
      summary.leaveNowFired.push(...s.leaveNowFired)
    }
    const removed = prune ? await pruneOldTrainStatuses() : null

    return NextResponse.json({
      ok: true,
      ...summary,
      ...(removed !== null ? { prunedRows: removed } : {}),
      at: new Date().toISOString(),
    })
  } catch (err) {
    // A provider outage must never look like a broken endpoint to the
    // scheduler, or it will retry a failure it cannot fix.
    console.error('[cron/train-poll]', err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'tick failed' },
      { status: 200 },
    )
  }
}

// Vercel Cron issues GET; curl and most other schedulers default to POST.
// Both do the same thing.
export const GET = handle
export const POST = handle
