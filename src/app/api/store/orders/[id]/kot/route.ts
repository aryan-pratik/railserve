import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/session'
import { findById } from '@/lib/repo/orderRepo'
import { enqueueOrderKotPrint, PrintAgentNotConfiguredError, assertPrintAgentConfigured } from '@/lib/printer/queue'

export const dynamic = 'force-dynamic'

/**
 * Manual (re)print — the same enqueue path generateKot() fires automatically
 * on ACCEPTED -> KOT_PRINTED. This route exists for the case that needs a
 * human decision (jammed paper, a lost docket), not a routine one.
 */
export async function POST(req: Request, ctx: RouteContext<'/api/store/orders/[id]/kot'>) {
  const auth = await requireRole('STORE_MANAGER', 'ADMIN')
  const { id } = await ctx.params

  const order = await findById(auth, id)
  if (!order) return NextResponse.json({ ok: false, error: 'Order not found' }, { status: 404 })
  if (!order.restaurantId) {
    return NextResponse.json({ ok: false, error: 'Order has no outlet to print at' }, { status: 409 })
  }

  try {
    assertPrintAgentConfigured()
    await enqueueOrderKotPrint({
      appOrigin: new URL(req.url).origin,
      restaurantId: order.restaurantId,
      orderId: id,
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

  return NextResponse.json({ ok: true })
}
