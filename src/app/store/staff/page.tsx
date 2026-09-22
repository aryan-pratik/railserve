import Link from 'next/link'
import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { Restaurant, User } from '@/lib/models'
import {
  Card, CardHeader, Dash, PageHeader, Pagination, PAGE_SIZE_OPTIONS, thClass, focusRing,
} from '@/components/ui'
import { OutletPills, stationToneMap } from '@/components/OutletPills'
import { StaffFormModal } from '@/app/admin/setup/StaffFormModal'
import { toggleUserActive } from '@/app/admin/setup/staffActions'

export const metadata = { title: 'Riders · RailServe' }

/** Same shape as admin's ActiveToggle, kept local since it is a two-line control. */
function ActiveToggle({
  id, active, name,
}: {
  id: string
  active: boolean
  name: string
}) {
  return (
    <form action={toggleUserActive}>
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

const DEFAULT_PAGE_SIZE = 20

/**
 * A store manager's own riders — a trimmed, outlet-scoped version of
 * admin's Setup → Staff tab. Only DELIVERY_AGENT staff at the outlets this
 * manager holds are visible or creatable here; StaffForm's `lockedRole`
 * hides the role picker entirely, and staffActions.ts enforces the same
 * restriction server-side, not just in this page's queries.
 */
export default async function StoreStaffPage(props: PageProps<'/store/staff'>) {
  const ctx = await requireRole('STORE_MANAGER', 'ADMIN')
  const sp = await props.searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''
  const editId = one(sp.edit) || undefined

  const pageParam = Number.parseInt(one(sp.page), 10)
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1
  const pageSizeParam = Number.parseInt(one(sp.pageSize), 10)
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(pageSizeParam)
    ? pageSizeParam
    : DEFAULT_PAGE_SIZE

  await connectDb()

  const outlets = await Restaurant.find({ _id: { $in: ctx.restaurantIds } })
    .sort({ active: -1, name: 1 })
    .lean()
  const outletById = new Map(outlets.map((o) => [String(o._id), o]))
  const stationTone = stationToneMap(outlets.map((o) => o.stationCode))

  const riderFilter = { role: 'DELIVERY_AGENT' as const, restaurantIds: { $in: ctx.restaurantIds } }
  const [riders, riderCount, editingUser] = await Promise.all([
    User.find(riderFilter)
      .sort({ active: -1, name: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    User.countDocuments(riderFilter),
    editId ? User.findById(editId).lean() : undefined,
  ])

  const paginationHref = ({ page: p, pageSize: ps }: { page: number; pageSize: number }) => {
    const u = new URLSearchParams()
    if (p > 1) u.set('page', String(p))
    if (ps !== DEFAULT_PAGE_SIZE) u.set('pageSize', String(ps))
    const qs = u.toString()
    return `/store/staff${qs ? `?${qs}` : ''}`
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Riders"
        note="The riders who work your outlets. Deactivate a rider you no longer use: there is no delete here."
      />

      <Card className="overflow-hidden">
        <CardHeader
          title={`${riderCount} rider${riderCount === 1 ? '' : 's'}`}
          action={
            <StaffFormModal
              key={editId ?? 'new'}
              editId={editId}
              lockedRole="DELIVERY_AGENT"
              addLabel="Add rider"
              editHref="/store/staff"
              outlets={outlets
                .filter((o) => o.active || editingUser?.restaurantIds.some((id) => String(id) === String(o._id)))
                .map((o) => ({
                  id: String(o._id), label: `${o.name} · ${o.stationCode}`, station: o.stationCode, stationName: o.stationName ?? undefined,
                }))}
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
          }
        />
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-sunken/60">
            <tr>
              <th className={thClass}>Name</th>
              <th className={`${thClass} hidden lg:table-cell`}>Phone</th>
              <th className={`${thClass} hidden sm:table-cell`}>Outlets</th>
              <th className={`${thClass} hidden w-px sm:table-cell`}>Status</th>
              <th className={`${thClass} w-px`}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {riders.map((u) => {
              const isEditing = editId === String(u._id)
              const myOutletIds = u.restaurantIds.map(String).filter((id) => outletById.has(id))
              return (
                <tr key={String(u._id)} className={isEditing ? 'bg-accent-soft/60' : u.active ? '' : 'bg-sunken/50 text-faint'}>
                  <td className="px-3 py-2.5 align-top">
                    <div className="font-medium text-ink [overflow-wrap:anywhere]">{u.name}</div>
                    <div className="font-mono text-xs tabular-nums text-muted lg:hidden">{u.phone}</div>
                  </td>
                  <td className="hidden px-3 py-2.5 align-top font-mono whitespace-nowrap tabular-nums text-muted lg:table-cell">{u.phone}</td>
                  <td className="hidden px-3 py-2.5 align-top text-muted sm:table-cell">
                    {myOutletIds.length > 0 ? (
                      <OutletPills ids={myOutletIds} outletById={outletById} stationTone={stationTone} />
                    ) : (
                      <Dash />
                    )}
                  </td>
                  <td className="hidden px-3 py-2.5 align-top sm:table-cell">
                    <ActiveToggle id={String(u._id)} active={u.active} name={u.name} />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="mb-1 flex justify-end sm:hidden">
                      <ActiveToggle id={String(u._id)} active={u.active} name={u.name} />
                    </div>
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        href={`/store/staff?edit=${String(u._id)}`}
                        className={`rounded px-1.5 py-1 text-sm font-medium text-accent underline-offset-2 hover:underline ${focusRing}`}
                      >
                        Edit
                      </Link>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {riderCount > 0 ? (
          <Pagination page={page} pageSize={pageSize} total={riderCount} buildHref={paginationHref} />
        ) : null}
      </Card>
    </div>
  )
}
