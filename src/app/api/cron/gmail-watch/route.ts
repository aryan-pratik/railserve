import { NextResponse } from 'next/server'
import { checkIngestStaleness, renewGmailWatch } from '@/lib/ingest/gmail/sync'
import { isGmailConfigured } from '@/lib/ingest/gmail/client'
import { cronAuthFailure } from '@/lib/cronAuth'
import { env } from '@/lib/env'

export const dynamic = 'force-dynamic'

/**
 * Renews the Gmail push watch. Run daily.
 *
 * A watch dies after exactly 7 days and takes push ingestion with it, raising
 * no error anywhere — the app keeps serving, the mailbox keeps filling, and
 * nothing arrives (plan §6, §13.4). That is the single failure mode of the
 * push transport, and this endpoint plus a daily schedule is the whole
 * defence against it. Renewing daily rather than every sixth day leaves six
 * consecutive failures' worth of slack before ingestion actually stops.
 *
 * A no-op when GMAIL_TOPIC_NAME is unset, so calling it while still on the
 * polling transport is harmless rather than an error.
 *
 * Also returns the ingest health check, so whatever schedules this can alert
 * on the response instead of needing a second endpoint.
 */
async function handle(request: Request) {
  const failure = cronAuthFailure(request)
  if (failure) return NextResponse.json({ error: failure }, { status: 401 })

  if (!isGmailConfigured()) {
    return NextResponse.json({ ok: false, reason: 'gmail not configured' }, { status: 200 })
  }
  if (!env.GMAIL_TOPIC_NAME) {
    return NextResponse.json(
      { ok: false, reason: 'GMAIL_TOPIC_NAME unset — still on the polling transport' },
      { status: 200 },
    )
  }

  try {
    const { expiresAt, historyId } = await renewGmailWatch()
    const health = await checkIngestStaleness()

    return NextResponse.json({
      ok: true,
      expiresAt,
      historyId,
      stale: health.stale,
      message: health.message,
      at: new Date().toISOString(),
    })
  } catch (err) {
    // A Google outage must never look like a broken endpoint to the scheduler,
    // or it will retry a failure it cannot fix. The next daily run retries,
    // and there are six days of slack before the watch actually lapses.
    console.error('[cron/gmail-watch]', err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'watch renewal failed' },
      { status: 200 },
    )
  }
}

// Vercel Cron issues GET; curl and most other schedulers default to POST.
export const GET = handle
export const POST = handle
