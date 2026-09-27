import { requireRole } from '@/lib/session'
import { riderBoard } from '@/lib/repo/riderLocationRepo'
import { readPage } from '@/lib/pagination'
import { formatServiceDate, todayIST } from '@/lib/format'
import { PageHeader } from '@/components/ui'
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
  const { page, pageSize } = readPage(await props.searchParams)

  const serviceDate = todayIST()
  const board = await riderBoard(ctx, { serviceDate })

  return (
    <div className="space-y-4">
      <PageHeader
        title="Riders"
        note={`${formatServiceDate(serviceDate)} · positions come from the rider app every ${PING_INTERVAL_SECONDS} seconds while it is open.`}
      />
      <RiderLiveBoard initial={board} page={page} pageSize={pageSize} />
    </div>
  )
}
