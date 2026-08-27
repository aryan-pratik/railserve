import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { Restaurant, User } from '@/lib/models'
import { Card, CardHeader } from '@/components/ui'
import { UserForm } from './UserForm'
import { toggleUserActive } from './actions'

export const metadata = { title: 'Staff · RailServe' }

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Admin',
  STORE_MANAGER: 'Store manager',
  DELIVERY_AGENT: 'Delivery agent',
}

export default async function UsersPage() {
  await requireRole('ADMIN')
  await connectDb()

  const [users, outlets] = await Promise.all([
    User.find({}).sort({ active: -1, role: 1, name: 1 }).lean(),
    Restaurant.find({ active: true }).select('name stationCode').sort({ name: 1 }).lean(),
  ])
  const outletName = new Map(outlets.map((o) => [String(o._id), `${o.name} · ${o.stationCode}`]))

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Staff</h1>
        <p className="mt-1 text-sm text-slate-600">
          Store managers are scoped to one outlet. Delivery agents see only orders assigned to them.
        </p>
      </div>

      <Card className="overflow-hidden">
        <CardHeader title={`${users.length} user${users.length === 1 ? '' : 's'}`} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Name</th>
                <th className="px-4 py-2.5 font-semibold">Phone</th>
                <th className="px-4 py-2.5 font-semibold">Role</th>
                <th className="px-4 py-2.5 font-semibold">Outlet</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => (
                <tr key={String(u._id)} className={u.active ? '' : 'bg-slate-50 text-slate-400'}>
                  <td className="px-4 py-3 font-medium text-slate-900">{u.name}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">{u.phone}</td>
                  <td className="px-4 py-3 text-slate-600">{ROLE_LABEL[u.role] ?? u.role}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {u.restaurantId ? (outletName.get(String(u.restaurantId)) ?? '—') : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <form action={toggleUserActive}>
                      <input type="hidden" name="id" value={String(u._id)} />
                      <input type="hidden" name="active" value={String(!u.active)} />
                      <button type="submit"
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
                          u.active
                            ? 'bg-emerald-100 text-emerald-800 ring-emerald-200'
                            : 'bg-slate-200 text-slate-600 ring-slate-300'
                        }`}>
                        {u.active ? 'Active' : 'Inactive'}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <UserForm
        outlets={outlets.map((o) => ({ id: String(o._id), label: `${o.name} — ${o.stationCode}` }))}
      />
    </div>
  )
}
