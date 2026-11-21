import { NextResponse } from 'next/server'
import { retryDirectPrintJobs } from '@/lib/printer/queue'
import { cronAuthFailure } from '@/lib/cronAuth'
import { connectDb } from '@/lib/db'
import { Tenant } from '@/lib/models'

export const dynamic = 'force-dynamic'

/**
 * Catches what tryDirectDeliver() missed at enqueue time — a printer or its
 * internet connection being briefly down. Only touches stations configured
 * for direct printing; every other station's jobs are still the polling
 * agent's to claim, untouched here.
 *
 * Runs for every active tenant: a suspended tenant's kitchens print nothing.
 */
async function handle(request: Request) {
  const failure = cronAuthFailure(request)
  if (failure) return NextResponse.json({ error: failure }, { status: 401 })

  try {
    await connectDb()
    const tenants = await Tenant.find({ status: 'ACTIVE' }).select('_id').lean()
    const summary = { attempted: 0, delivered: 0 }
    for (const t of tenants) {
      const s = await retryDirectPrintJobs(t._id)
      summary.attempted += s.attempted
      summary.delivered += s.delivered
    }
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
