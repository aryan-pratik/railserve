import { requireRole } from '@/lib/session'
import { riderBoard } from '@/lib/repo/riderLocationRepo'
import { todayIST } from '@/lib/format'
import { PING_INTERVAL_SECONDS } from '@/lib/riderLocation'
import { RiderLiveBoard } from './RiderLiveBoard'

export const metadata = { title: 'Riders · RailServe' }

// Positions are never the same twice; there is nothing here to prerender.
export const dynamic = 'force-dynamic'

/**
 * Where every rider is, right now.
 *
 * The board renders once on the server so the page arrives with real content
 * rather than a spinner that fills in a beat later, and from then on the
 * client owns it — see RiderLiveBoard for why this one polls rather than
 * calling router.refresh() like the kitchen and call boards.
 *
 * What a rider's phone sends is a position, a speed and an accuracy, and
 * nothing else: no history beyond the last few minutes of path, and nothing
 * kept once the next shift overwrites it. The sharing is visible on the
 * rider's own screen while it happens.
 */
export default async function RidersPage(props: PageProps<'/admin/riders'>) {
  const ctx = await requireRole('ADMIN')
  const sp = await props.searchParams
  const requested = Array.isArray(sp.date) ? sp.date[0] : sp.date
  // Any other day is read-only history; the board still polls it, since the
  // same route serves every date.
  const serviceDate = /^\d{4}-\d{2}-\d{2}$/.test(requested ?? '') ? requested! : todayIST()
  const board = await riderBoard(ctx, { serviceDate })

  return (
    <RiderLiveBoard
      initial={board}
      today={todayIST()}
      note={`Live tracking and performance of all delivery riders. Positions arrive from the rider app every ${PING_INTERVAL_SECONDS}s while it is open.`}
    />
  )
}
