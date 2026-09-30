import { NextResponse } from 'next/server'
import { retryDirectPrintJobs } from '@/lib/printer/queue'
import { cronAuthFailure } from '@/lib/cronAuth'

export const dynamic = 'force-dynamic'

/**
 * Catches what tryDirectDeliver() missed at enqueue time — a printer or its
 * internet connection being briefly down. Only touches stations configured
 * for direct printing; every other station's jobs are still the polling
 * agent's to claim, untouched here.
 */
async function handle(request: Request) {
  const failure = cronAuthFailure(request)
  if (failure) return NextResponse.json({ error: failure }, { status: 401 })

  try {
    const summary = await retryDirectPrintJobs()
    return NextResponse.json({ ok: true, ...summary, at: new Date().toISOString() })
  } catch (err) {
    // A printer/network outage must never look like a broken endpoint to the
    // scheduler, or it will retry a failure it cannot fix — see train-poll.
    console.error('[cron/print-retry]', err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'print-retry failed' },
      { status: 200 },
    )
  }
}

export const GET = handle
export const POST = handle
