import { NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { isGmailConfigured } from '@/lib/ingest/gmail/client'
import { syncGmailHistory } from '@/lib/ingest/gmail/sync'

export const dynamic = 'force-dynamic'

/**
 * Pub/Sub push endpoint for Gmail notifications (plan §6).
 *
 * The notification carries no message content, only a historyId — the actual
 * fetch is history.list + messages.get in syncGmailHistory().
 *
 * Always answers 200 on anything it has accepted. Pub/Sub retries non-2xx
 * responses with backoff, and a poison message that fails forever would block
 * the subscription; ingestion errors are recorded instead, where the unparsed
 * inbox and the staleness alert can surface them.
 */
export async function POST(request: Request) {
  if (!isGmailConfigured()) {
    return NextResponse.json({ ok: false, reason: 'gmail not configured' }, { status: 503 })
  }

  // Pub/Sub push subscriptions can append a shared secret to the endpoint URL.
  if (env.GMAIL_WEBHOOK_TOKEN) {
    const url = new URL(request.url)
    const token = url.searchParams.get('token') ?? request.headers.get('x-webhook-token')
    if (token !== env.GMAIL_WEBHOOK_TOKEN) {
      return NextResponse.json({ ok: false }, { status: 401 })
    }
  }

  try {
    const summary = await syncGmailHistory()
    return NextResponse.json({ ok: true, ...summary })
  } catch (err) {
    console.error('[gmail-webhook]', err)
    // Acknowledge anyway — see above.
    return NextResponse.json({ ok: false, error: 'sync failed' })
  }
}
