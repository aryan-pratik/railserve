import { requireRole } from '@/lib/session'
import { loadRiderRoster, readOpsDay } from '@/lib/v2/riders'

export const dynamic = 'force-dynamic'

/**
 * The roster's data, polled by the board every few seconds. A JSON poll, not
 * SSE, for the reasons on /api/admin/riders: positions change constantly, so
 * there is nothing for a stream to wait on. Scoped to the caller inside
 * `loadRiderRoster`, which is what lets a store manager read it.
 */
export async function GET(request: Request) {
  const ctx = await requireRole('ADMIN', 'STORE_MANAGER')
  const serviceDate = readOpsDay(new URL(request.url).searchParams.get('date') ?? undefined)
  const roster = await loadRiderRoster(ctx, { serviceDate })
  // A cached rider position is a wrong rider position.
  return Response.json(roster, { headers: { 'Cache-Control': 'no-store' } })
}
