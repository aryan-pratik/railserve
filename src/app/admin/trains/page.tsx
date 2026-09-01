import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'
import { PageHeader } from '@/components/ui'
import { todayIST } from '@/lib/format'
import { TrainLookupForm } from './TrainLookupForm'

export const metadata = { title: 'Train status · RailServe' }

/**
 * Ask about any train, not just one somebody ordered from.
 *
 * The board only ever polls trains that have an active order, which is right
 * for the quota but leaves no way to answer "is 12561 running late today?"
 * before the orders land. Admin-only because each lookup spends a request
 * against the train API plan.
 */
export default async function TrainStatusPage() {
  await requireRole('ADMIN')

  await connectDb()
  const outlets = await Restaurant.find({ active: true }).select('stationCode').lean()
  const stations = [...new Set(outlets.map((o) => o.stationCode.toUpperCase()))].sort()

  return (
    <div className="space-y-5">
      <PageHeader
        title="Train status"
        note="Live arrival, delay and platform for any train at any station. Each check also refreshes what the store and rider boards show for that train."
      />
      <TrainLookupForm stations={stations} today={todayIST()} />
    </div>
  )
}
