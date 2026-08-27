import { Placeholder } from '@/components/Placeholder'
import { requireRole } from '@/lib/session'
import { countByStatus } from '@/lib/repo/orderRepo'

export default async function AdminOrdersPage() {
  const ctx = await requireRole('ADMIN')
  const counts = await countByStatus(ctx)
  const total = Object.values(counts).reduce((a, b) => a + b, 0)

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">All orders</h1>
      <p className="text-sm text-slate-600">
        {total} order(s) visible to you across all outlets.
      </p>
      <Placeholder
        title="Order list lands in Step C"
        note="Auth, scoping and the status machine are in place. The manual entry form and this list are next."
      />
    </div>
  )
}
