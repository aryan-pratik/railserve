import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/session'
import { findRun } from '@/lib/repo/runRepo'
import { enqueueRunKotPrint, getAppOrigin, PrintAgentNotConfiguredError, assertPrintAgentConfigured } from '@/lib/printer/queue'

export const dynamic = 'force-dynamic'

/**
 * Manual reprint for a whole train — see the order route's equivalent note.
 *
 * Reprints only the orders whose KOT has gone out and that are still being
 * cooked (KOT_PRINTED). The rest of the train either has no KOT yet (the
 * board's "Print N KOTs" sends those, with the status change) or is past the
 * kitchen.
 */
export async function POST(req: Request, ctx: RouteContext<'/api/store/runs/[runKey]/kot'>) {
  const auth = await requireRole('STORE_MANAGER', 'ADMIN')
  const { runKey } = await ctx.params

  const run = await findRun(auth, decodeURIComponent(runKey))
  if (!run || run.orders.length === 0) {
    return NextResponse.json({ ok: false, error: 'Run not found' }, { status: 404 })
  }

  const orderIds = run.orders.filter((o) => o.status === 'KOT_PRINTED').map((o) => String(o._id))
  if (orderIds.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'No order on this train is waiting in the kitchen' },
      { status: 409 },
    )
  }

  try {
    assertPrintAgentConfigured()
    await enqueueRunKotPrint({
      appOrigin: await getAppOrigin(),
      runKey,
      orderIds,
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

  return NextResponse.json({ ok: true, count: orderIds.length })
}
