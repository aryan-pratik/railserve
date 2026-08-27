import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { Restaurant } from '@/lib/models'
import { Card, CardHeader } from '@/components/ui'
import { RestaurantForm } from './RestaurantForm'
import { toggleRestaurantActive } from './actions'

export const metadata = { title: 'Outlets · RailServe' }

export default async function RestaurantsPage() {
  await requireRole('ADMIN')
  await connectDb()

  const outlets = await Restaurant.find({}).sort({ active: -1, name: 1 }).lean()

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Outlets</h1>
        <p className="mt-1 text-sm text-slate-600">
          Partner kitchens. Deactivated rather than deleted, so existing orders keep pointing at
          something real.
        </p>
      </div>

      <Card className="overflow-hidden">
        <CardHeader title={`${outlets.length} outlet${outlets.length === 1 ? '' : 's'}`} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Outlet</th>
                <th className="px-4 py-2.5 font-semibold">Station</th>
                <th className="px-4 py-2.5 font-semibold">Aliases</th>
                <th className="px-4 py-2.5 font-semibold">Walk</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {outlets.map((o) => (
                <tr key={String(o._id)} className={o.active ? '' : 'bg-slate-50 text-slate-400'}>
                  <td className="px-4 py-3 font-medium text-slate-900">{o.name}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {o.stationCode}
                    <span className="ml-1 text-xs text-slate-400">{o.stationName}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {o.aliases.length ? o.aliases.join(', ') : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{o.walkToPlatformMinutes}m</td>
                  <td className="px-4 py-3">
                    <form action={toggleRestaurantActive}>
                      <input type="hidden" name="id" value={String(o._id)} />
                      <input type="hidden" name="active" value={String(!o.active)} />
                      <button type="submit"
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
                          o.active
                            ? 'bg-emerald-100 text-emerald-800 ring-emerald-200'
                            : 'bg-slate-200 text-slate-600 ring-slate-300'
                        }`}>
                        {o.active ? 'Active' : 'Inactive'}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <RestaurantForm />
    </div>
  )
}
