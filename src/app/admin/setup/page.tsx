import Link from 'next/link'
import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { Restaurant, User } from '@/lib/models'
import { Card, CardHeader, Dash, PageHeader, Tabs, thClass, focusRing } from '@/components/ui'
import { ROLE_LABEL } from '@/lib/roles'
import { OutletForm } from './OutletForm'
import { StaffForm } from './StaffForm'
import { toggleRestaurantActive } from './outletActions'
import { toggleUserActive } from './staffActions'

export const metadata = { title: 'Setup · RailServe' }

/** Active/inactive is a one-click toggle. Nothing here is ever hard-deleted. */
function ActiveToggle({
  id, active, action, name,
}: {
  id: string
  active: boolean
  action: (formData: FormData) => Promise<void>
  name: string
}) {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={String(!active)} />
      <button
        type="submit"
        aria-label={`${active ? 'Deactivate' : 'Activate'} ${name}`}
        title={active ? 'Click to deactivate' : 'Click to activate'}
        className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition-colors ${focusRing} ${
          active
            ? 'bg-emerald-100 text-emerald-800 ring-emerald-200 hover:bg-emerald-200'
            : 'bg-slate-200 text-slate-600 ring-slate-300 hover:bg-slate-300'
        }`}
      >
        {active ? 'Active' : 'Inactive'}
      </button>
    </form>
  )
}

export default async function SetupPage(props: PageProps<'/admin/setup'>) {
  await requireRole('ADMIN')
  const { tab, edit } = await props.searchParams
  const staff = tab === 'staff'
  const editId = typeof edit === 'string' ? edit : undefined

  await connectDb()
  const [outlets, users] = await Promise.all([
    Restaurant.find({}).sort({ active: -1, name: 1 }).lean(),
    staff ? User.find({}).sort({ active: -1, role: 1, name: 1 }).lean() : [],
  ])

  const outletName = new Map(outlets.map((o) => [String(o._id), `${o.name} · ${o.stationCode}`]))
  const editingUser = editId ? users.find((u) => String(u._id) === editId) : undefined

  return (
    <div className="space-y-4">
      <PageHeader
        title="Setup"
        note="Outlets and the people who work them. Nothing here is deleted; it is deactivated, so existing orders keep pointing at something real."
      />

      <Tabs
        label="Setup"
        tabs={[
          { href: '/admin/setup', label: 'Outlets', count: outlets.length, active: !staff },
          { href: '/admin/setup?tab=staff', label: 'Staff', active: staff },
        ]}
      />

      {staff ? (
        <>
          <Card className="overflow-hidden">
            <CardHeader title={`${users.length} user${users.length === 1 ? '' : 's'}`} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="border-b border-line bg-sunken/60">
                  <tr>
                    <th className={thClass}>Name</th>
                    <th className={thClass}>Phone</th>
                    <th className={thClass}>Role</th>
                    <th className={thClass}>Outlets</th>
                    <th className={thClass}>Status</th>
                    <th className={thClass}><span className="sr-only">Edit</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {users.map((u) => {
                    const isEditing = editId === String(u._id)
                    return (
                      <tr key={String(u._id)} className={isEditing ? 'bg-accent-soft/60' : u.active ? '' : 'bg-sunken/50 text-faint'}>
                        <td className="px-3 py-2.5 font-medium text-ink">{u.name}</td>
                        <td className="px-3 py-2.5 font-mono tabular-nums text-muted">{u.phone}</td>
                        <td className="px-3 py-2.5 text-muted">{ROLE_LABEL[u.role] ?? u.role}</td>
                        <td className="px-3 py-2.5 text-muted">
                          {u.restaurantIds.length > 0
                            ? u.restaurantIds.map((id) => outletName.get(String(id)) ?? 'Unknown outlet').join(', ')
                            : <Dash />}
                        </td>
                        <td className="px-3 py-2.5">
                          <ActiveToggle id={String(u._id)} active={u.active} action={toggleUserActive} name={u.name} />
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <Link
                            href={isEditing ? '/admin/setup?tab=staff' : `/admin/setup?tab=staff&edit=${String(u._id)}`}
                            className="text-sm font-medium text-accent underline-offset-2 hover:underline"
                          >
                            {isEditing ? 'Cancel' : 'Edit'}
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <StaffForm
            key={editId ?? 'new'}
            outlets={outlets
              // An outlet a manager already holds must stay selectable even if
              // it was deactivated after the fact.
              .filter((o) => o.active || editingUser?.restaurantIds.some((id) => String(id) === String(o._id)))
              .map((o) => ({ id: String(o._id), label: `${o.name} · ${o.stationCode}` }))}
            values={
              editingUser
                ? {
                    id: String(editingUser._id),
                    name: editingUser.name,
                    phone: editingUser.phone,
                    role: editingUser.role,
                    restaurantIds: editingUser.restaurantIds.map(String),
                  }
                : undefined
            }
          />
        </>
      ) : (
        <>
          <Card className="overflow-hidden">
            <CardHeader title={`${outlets.length} outlet${outlets.length === 1 ? '' : 's'}`} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="border-b border-line bg-sunken/60">
                  <tr>
                    <th className={thClass}>Outlet</th>
                    <th className={thClass}>Station</th>
                    <th className={thClass}>Aliases</th>
                    <th className={thClass}>Walk</th>
                    <th className={thClass}>Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {outlets.map((o) => (
                    <tr key={String(o._id)} className={o.active ? '' : 'bg-sunken/50 text-faint'}>
                      <td className="px-3 py-2.5 font-medium text-ink">{o.name}</td>
                      <td className="px-3 py-2.5 text-muted">
                        <span className="font-mono">{o.stationCode}</span>
                        <span className="ml-1.5 text-xs text-faint">{o.stationName}</span>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-faint">{o.aliases.length ? o.aliases.join(', ') : <Dash />}</td>
                      <td className="px-3 py-2.5 tabular-nums text-muted">{o.walkToPlatformMinutes} min</td>
                      <td className="px-3 py-2.5">
                        <ActiveToggle id={String(o._id)} active={o.active} action={toggleRestaurantActive} name={o.name} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <OutletForm />
        </>
      )}
    </div>
  )
}
