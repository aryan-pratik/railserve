import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'
import { todayIST } from '@/lib/format'
import { EmptyState } from '@/components/ui'
import { OrderForm } from './OrderForm'

export const metadata = { title: 'New order · RailServe' }

export default async function NewOrderPage() {
  await requireRole('ADMIN')
  await connectDb()

  const outlets = await Restaurant.find({ active: true })
    .select('name stationCode stationName')
    .sort({ name: 1 })
    .lean()

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold">New order</h1>
        <p className="mt-1 text-sm text-slate-600">
          Manual entry. Gmail and WhatsApp ingestion write this same document later.
        </p>
      </div>

      {outlets.length === 0 ? (
        <EmptyState
          title="No active outlets"
          note="Add an outlet before creating orders — an order must belong to a kitchen."
        />
      ) : (
        <OrderForm
          today={todayIST()}
          outlets={outlets.map((o) => ({
            id: String(o._id),
            name: o.name,
            stationCode: o.stationCode,
            stationName: o.stationName ?? null,
          }))}
        />
      )}
    </div>
  )
}
