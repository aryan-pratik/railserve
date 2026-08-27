import { EmptyState } from '@/components/ui'
import { requireRole } from '@/lib/session'
import { countByStatus } from '@/lib/repo/orderRepo'

export default async function StorePage() {
  const ctx = await requireRole('STORE_MANAGER', 'ADMIN')
  const counts = await countByStatus(ctx)
  const total = Object.values(counts).reduce((a, b) => a + b, 0)

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Today</h1>
      <p className="text-sm text-slate-600">
        {total} order(s) visible to you — scoped to your outlet only.
      </p>
      <EmptyState
        title="Store dashboard lands in Step D"
        note="Accept, Generate KOT and Mark Prepared build on the transition engine that is already tested."
      />
    </div>
  )
}
