import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/session'
import { findRun } from '@/lib/repo/runRepo'
import { enqueueRunKotPrint, PrintAgentNotConfiguredError, assertPrintAgentConfigured } from '@/lib/printer/queue'

export const dynamic = 'force-dynamic'

/** Manual (re)print for a whole train — see the order route's equivalent note. */
export async function POST(req: Request, ctx: RouteContext<'/api/store/runs/[runKey]/kot'>) {
  const auth = await requireRole('STORE_MANAGER', 'ADMIN')
  const { runKey } = await ctx.params

  const run = await findRun(auth, decodeURIComponent(runKey))
  if (!run || run.orders.length === 0) {
    return NextResponse.json({ ok: false, error: 'Run not found' }, { status: 404 })
  }

  try {
    assertPrintAgentConfigured()
    await enqueueRunKotPrint({
      appOrigin: new URL(req.url).origin,
      runKey,
      orders: run.orders,
    })
  } catch (err) {
    if (err instanceof PrintAgentNotConfiguredError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 503 })
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Print failed' },
      { status: 502 },
    )
  }

  return NextResponse.json({ ok: true, count: run.orders.length })
}
