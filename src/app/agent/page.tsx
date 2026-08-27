import { EmptyState } from '@/components/ui'
import { requireRole } from '@/lib/session'
import { countByStatus } from '@/lib/repo/orderRepo'

export default async function AgentPage() {
  const ctx = await requireRole('DELIVERY_AGENT')
  const counts = await countByStatus(ctx)
  const total = Object.values(counts).reduce((a, b) => a + b, 0)

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">My runs</h1>
      <p className="text-sm text-slate-600">
        {total} order(s) assigned to you.
      </p>
      <EmptyState
        title="Delivery screens land in Step E"
        note="Dispatch and deliver with proof capture, once admin assignment exists."
      />
    </div>
  )
}
