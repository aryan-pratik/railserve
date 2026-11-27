import { NextResponse } from 'next/server'
import { syncGmailHistory, syncLinkedMailboxes } from '@/lib/ingest/gmail/sync'
import { sendPendingNotices } from '@/lib/repo/onboardingRepo'
import { cronAuthFailure } from '@/lib/cronAuth'

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
  const failure = cronAuthFailure(request)
  if (failure) return NextResponse.json({ error: failure }, { status: 401 })

  try {
    // The server mailbox exactly as before, then every linked one. A failing
    // linked mailbox records its own error and does not stop the others.
    const summary = await syncGmailHistory()
    const linked = await syncLinkedMailboxes()
    // Messages owed to companies that are joining (lib/mailer). Never allowed
    // to break order reading: a failure here is only reported.
    const notices = await sendPendingNotices().catch((err) => ({ sent: 0, failed: 0, skipped: err instanceof Error ? err.message : 'failed' }))
    return NextResponse.json({ ok: true, ...summary, linked: linked.map((l) => ({ email: l.email, created: l.summary.created, errors: l.summary.errors.length })), notices, at: new Date().toISOString() })
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
