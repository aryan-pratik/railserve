import { requireRole } from '@/lib/session'
import { EmptyState } from '@/components/ui'

export const metadata = { title: 'Runs · RailServe' }

export default async function RunsPage() {
  await requireRole('ADMIN')
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Runs</h1>
      <EmptyState
        title="Runs land in Step E"
        note="Orders grouped by train, with agent assignment and dispatch state. Assign agents from an order's detail page in the meantime."
      />
    </div>
  )
}
