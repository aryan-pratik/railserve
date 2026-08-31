import { NextResponse } from 'next/server'
import { syncGmailHistory } from '@/lib/ingest/gmail/sync'
import { env } from '@/lib/env'

export const dynamic = 'force-dynamic'

/**
 * Polls Gmail for new order emails and ingests them.
 *
 * Mirrors /api/cron/train-poll: no background worker, no Redis — a scheduler
 * calling this on an interval *is* the sync mechanism. syncGmailHistory()
 * seeds its own resume point (a Gmail watch registration) on first run and
 * advances a stored historyId after each successful pass, so a missed or
 * doubled-up tick is harmless — ingestion is idempotent on gmailMessageId.
 *
 * A no-op (all-blank summary) when GMAIL_* env vars are unset, so wiring this
 * up before credentials exist is safe.
 */
async function handle(request: Request) {
  const expected = env.CRON_TOKEN
  if (expected) {
    const url = new URL(request.url)
    const supplied =
      request.headers.get('x-cron-token') ??
      request.headers.get('authorization')?.replace(/^Bearer /i, '') ??
      url.searchParams.get('token') ??
      ''
    if (supplied !== expected) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const summary = await syncGmailHistory()
    return NextResponse.json({ ok: true, ...summary, at: new Date().toISOString() })
  } catch (err) {
    // A Gmail outage must never look like a broken endpoint to the scheduler,
    // or it will retry a failure it cannot fix.
    console.error('[cron/gmail-sync]', err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'sync failed' },
      { status: 200 },
    )
  }
}

// Vercel Cron issues GET; curl and most other schedulers default to POST.
export const GET = handle
export const POST = handle
