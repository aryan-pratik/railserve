import { NextResponse } from 'next/server'
import { runTrainPollingTick, pruneOldTrainStatuses } from '@/lib/queue/trainPolling'
import { env } from '@/lib/env'

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
 */
async function handle(request: Request) {
  const expected = env.CRON_TOKEN
  if (expected) {
    const url = new URL(request.url)
    const supplied =
      request.headers.get('x-cron-token') ??
      // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; accept that
      // shape too so the same endpoint works from their scheduler unchanged.
      request.headers.get('authorization')?.replace(/^Bearer /i, '') ??
      url.searchParams.get('token') ??
      ''
    if (supplied !== expected) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const prune = new URL(request.url).searchParams.get('prune') === '1'

  try {
    const summary = await runTrainPollingTick()
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
