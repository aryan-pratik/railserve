import { requireRole } from '@/lib/session'
import { riderBoard } from '@/lib/repo/riderLocationRepo'
import { todayIST } from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * The rider board's data, refetched every few seconds by the page itself.
 *
 * A JSON poll rather than the SSE the payments and cancellation feeds use.
 * Those push because their events are rare and sudden — a payment lands, or a
 * telecaller cancels — and a timer would mean sitting on the news. Positions
 * are the opposite: they change constantly and nothing is ever "new", so there
 * is nothing for a stream to wait on, and holding a connection open per admin
 * tab buys nothing over asking. The codebase already notes the other half of
 * it on /api/store/cancellations: a proxy that buffers SSE fails silently,
 * with the connection open and no frame ever arriving. A poll cannot fail that
 * way, and the board can tell the operator the moment it stops succeeding.
 *
 * Returns positions, not a map: what to draw is the client's business, and the
 * same payload feeds the list beside it.
 */
export async function GET(request: Request) {
  const ctx = await requireRole('ADMIN')

  const requested = new URL(request.url).searchParams.get('serviceDate')
  const serviceDate = /^\d{4}-\d{2}-\d{2}$/.test(requested ?? '') ? requested! : todayIST()

  const board = await riderBoard(ctx, { serviceDate })

  return Response.json(board, {
    // Never cached, by the browser or anything between. A cached rider
    // position is a wrong rider position.
    headers: { 'Cache-Control': 'no-store' },
  })
}
