import Link from 'next/link'
import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { Restaurant, User } from '@/lib/models'
import {
  Card, CardHeader, Dash, PageHeader, Pagination, Tabs, PAGE_SIZE_OPTIONS, thClass, focusRing,
} from '@/components/ui'
import { ROLE_LABEL } from '@/lib/roles'
import { OutletFormModal } from './OutletFormModal'
import { StaffFormModal } from './StaffFormModal'
import { deleteRestaurant, toggleRestaurantActive } from './outletActions'
import { deleteUser, toggleUserActive } from './staffActions'
import { DeleteRowButton } from './DeleteRowButton'

export const metadata = { title: 'Setup · RailServe' }

/**
 * Active/inactive is a one-click toggle, and the normal way to retire a row.
 * Delete exists too, but only for a row nothing points at yet.
 */
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

/**
 * One pill colour per station, not per outlet.
 *
 * There are a dozen outlets and a handful of stations. Nobody can learn twelve
 * hues, and neighbouring hues blur together, whereas "is this person on CNB or
 * on Gaya" is exactly what a manager scans this column for. Emerald is left
 * out on purpose: it already means Active in the column beside this one.
 */
const STATION_TONES = [
  'bg-sky-50 text-sky-800 ring-sky-200',
  'bg-violet-50 text-violet-800 ring-violet-200',
  'bg-amber-50 text-amber-900 ring-amber-200',
  'bg-rose-50 text-rose-800 ring-rose-200',
  'bg-teal-50 text-teal-800 ring-teal-200',
  'bg-indigo-50 text-indigo-800 ring-indigo-200',
] as const

/**
 * The station, in its colour. The same tone the Staff tab's outlet pills use,
 * so CNB reads as the same blue on both tabs.
 */
function StationPill({ code, name, tone }: { code: string; name?: string | null; tone?: string }) {
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <span
        className={`rounded-full px-2 py-0.5 font-mono text-xs font-semibold ring-1 ring-inset ${tone ?? 'bg-sunken text-muted ring-line'}`}
      >
        {code}
      </span>
      {name ? <span className="text-xs text-faint [overflow-wrap:anywhere]">{name}</span> : null}
    </span>
  )
}

type OutletLite = { name: string; stationCode: string }

/** Grouped by station, then by name, so each colour sits together. */
function OutletPills({
  ids,
  outletById,
  stationTone,
}: {
  ids: string[]
  outletById: Map<string, OutletLite>
  stationTone: Map<string, string>
}) {
  const known = ids
    .map((id) => outletById.get(id))
    .filter((o): o is OutletLite => Boolean(o))
    .sort((a, b) => a.stationCode.localeCompare(b.stationCode) || a.name.localeCompare(b.name))
  const unknown = ids.length - known.length

  return (
    <span className="flex flex-wrap gap-1">
      {known.map((o) => (
        <span
          key={`${o.stationCode}-${o.name}`}
          title={`${o.name} · ${o.stationCode}`}
          className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset [overflow-wrap:anywhere] ${stationTone.get(o.stationCode) ?? 'bg-sunken text-muted ring-line'}`}
        >
          {o.name}
          <span className="font-mono text-[10px] opacity-70">{o.stationCode}</span>
        </span>
      ))}
      {unknown > 0 ? (
        <span className="rounded-full bg-sunken px-2 py-0.5 text-xs text-muted ring-1 ring-inset ring-line">
          {unknown} unknown
        </span>
      ) : null}
    </span>
  )
}

const DEFAULT_PAGE_SIZE = 20

export default async function SetupPage(props: PageProps<'/admin/setup'>) {
  await requireRole('ADMIN')
  const sp = await props.searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''
  const staff = one(sp.tab) === 'staff'
  const editId = one(sp.edit) || undefined

  const pageParam = Number.parseInt(one(sp.page), 10)
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1
  const pageSizeParam = Number.parseInt(one(sp.pageSize), 10)
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(pageSizeParam)
    ? pageSizeParam
    : DEFAULT_PAGE_SIZE

  await connectDb()
  const [outlets, users, userCount, editingUser] = await Promise.all([
    // Unpaginated: also feeds the outlet-name lookup and the staff form's outlet picker.
    Restaurant.find({}).sort({ active: -1, name: 1 }).lean(),
    staff
      ? User.find({}).sort({ active: -1, role: 1, name: 1 }).skip((page - 1) * pageSize).limit(pageSize).lean()
      : [],
    staff ? User.countDocuments({}) : 0,
    // Fetched separately so an edit target still resolves even off the current page.
    editId && staff ? User.findById(editId).lean() : undefined,
  ])

  const outletById = new Map(outlets.map((o) => [String(o._id), o]))

  // Each station gets one pill colour, assigned by sorted order so it is
  // stable between visits and two stations never share one until there are
  // more stations than colours.
  const stationTone = new Map(
    [...new Set(outlets.map((o) => o.stationCode))]
      .sort()
      .map((code, i) => [code, STATION_TONES[i % STATION_TONES.length]]),
  )
  const outletsPage = staff ? [] : outlets.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize)

  const paginationHref = ({ page: p, pageSize: ps }: { page: number; pageSize: number }) => {
    const u = new URLSearchParams()
    if (staff) u.set('tab', 'staff')
    if (p > 1) u.set('page', String(p))
    if (ps !== DEFAULT_PAGE_SIZE) u.set('pageSize', String(ps))
    const qs = u.toString()
    return `/admin/setup${qs ? `?${qs}` : ''}`
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Setup"
        note="Outlets and the people who work them. Deactivate anything that has been used; delete only works on rows nothing points at, so existing orders always point at something real."
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
            <CardHeader
              title={`${userCount} user${userCount === 1 ? '' : 's'}`}
              action={
                <StaffFormModal
                  key={editId ?? 'new'}
                  editId={editId}
                  outlets={outlets
                    // An outlet a manager already holds must stay selectable even if
                    // it was deactivated after the fact.
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
            {/* No horizontal scroll at any width. Columns drop out as the screen
                narrows and fold into a neighbouring cell, so nothing is lost:
                Phone below lg; Role and Outlets into Name below sm; Status into
                the actions cell below sm. A phone gets two columns. */}
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-sunken/60">
                <tr>
                  <th className={thClass}>Name</th>
                  <th className={`${thClass} hidden lg:table-cell`}>Phone</th>
                  <th className={`${thClass} hidden sm:table-cell`}>Role</th>
                  <th className={`${thClass} hidden sm:table-cell`}>Outlets</th>
                  <th className={`${thClass} hidden w-px sm:table-cell`}>Status</th>
                  <th className={`${thClass} w-px`}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {users.map((u) => {
                  const isEditing = editId === String(u._id)
                  return (
                    <tr key={String(u._id)} className={isEditing ? 'bg-accent-soft/60' : u.active ? '' : 'bg-sunken/50 text-faint'}>
                      <td className="px-3 py-2.5 align-top">
                        <div className="font-medium text-ink [overflow-wrap:anywhere]">{u.name}</div>
                        <div className="font-mono text-xs tabular-nums text-muted lg:hidden">{u.phone}</div>
                        <div className="text-xs text-muted sm:hidden">{ROLE_LABEL[u.role] ?? u.role}</div>
                        {u.restaurantIds.length > 0 ? (
                          <div className="mt-1.5 sm:hidden">
                            <OutletPills ids={u.restaurantIds.map(String)} outletById={outletById} stationTone={stationTone} />
                          </div>
                        ) : null}
                      </td>
                      <td className="hidden px-3 py-2.5 align-top font-mono whitespace-nowrap tabular-nums text-muted lg:table-cell">{u.phone}</td>
                      <td className="hidden px-3 py-2.5 align-top whitespace-nowrap text-muted sm:table-cell">{ROLE_LABEL[u.role] ?? u.role}</td>
                      <td className="hidden px-3 py-2.5 align-top text-muted sm:table-cell">
                        {u.restaurantIds.length > 0
                          ? <OutletPills ids={u.restaurantIds.map(String)} outletById={outletById} stationTone={stationTone} />
                          : <Dash />}
                      </td>
                      <td className="hidden px-3 py-2.5 align-top sm:table-cell">
                        <ActiveToggle id={String(u._id)} active={u.active} action={toggleUserActive} name={u.name} />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="mb-1 flex justify-end sm:hidden">
                          <ActiveToggle id={String(u._id)} active={u.active} action={toggleUserActive} name={u.name} />
                        </div>
                        <div className="flex items-center justify-end gap-1">
                          <Link
                            href={`/admin/setup?tab=staff&edit=${String(u._id)}`}
                            className={`rounded px-1.5 py-1 text-sm font-medium text-accent underline-offset-2 hover:underline ${focusRing}`}
                          >
                            Edit
                          </Link>
                          <DeleteRowButton id={String(u._id)} name={u.name} noun="staff member" action={deleteUser} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {userCount > 0 ? (
              <Pagination page={page} pageSize={pageSize} total={userCount} buildHref={paginationHref} />
            ) : null}
          </Card>
        </>
      ) : (
        <>
          <Card className="overflow-hidden">
            <CardHeader
              title={`${outlets.length} outlet${outlets.length === 1 ? '' : 's'}`}
              action={<OutletFormModal />}
            />
            {/* No horizontal scroll: Station folds into the Outlet cell below
                md, Aliases disappear below lg, Walk below sm. */}
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-sunken/60">
                <tr>
                  <th className={thClass}>Outlet</th>
                  <th className={`${thClass} hidden md:table-cell`}>Station</th>
                  <th className={`${thClass} hidden lg:table-cell`}>Aliases</th>
                  <th className={`${thClass} hidden w-px sm:table-cell`}>Walk</th>
                  <th className={`${thClass} w-px`}>Status</th>
                  <th className={`${thClass} w-px`}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {outletsPage.map((o) => (
                  <tr key={String(o._id)} className={o.active ? '' : 'bg-sunken/50 text-faint'}>
                    <td className="px-3 py-2.5 align-top">
                      <div className="font-medium text-ink [overflow-wrap:anywhere]">{o.name}</div>
                      <div className="mt-1 md:hidden">
                        <StationPill code={o.stationCode} name={o.stationName} tone={stationTone.get(o.stationCode)} />
                      </div>
                    </td>
                    <td className="hidden px-3 py-2.5 align-top md:table-cell">
                      <StationPill code={o.stationCode} name={o.stationName} tone={stationTone.get(o.stationCode)} />
                    </td>
                    <td className="hidden px-3 py-2.5 align-top text-xs text-faint [overflow-wrap:anywhere] lg:table-cell">
                      {o.aliases.length ? o.aliases.join(', ') : <Dash />}
                    </td>
                    <td className="hidden px-3 py-2.5 align-top whitespace-nowrap tabular-nums text-muted sm:table-cell">{o.walkToPlatformMinutes} min</td>
                    <td className="px-3 py-2.5 align-top">
                      <ActiveToggle id={String(o._id)} active={o.active} action={toggleRestaurantActive} name={o.name} />
                    </td>
                    <td className="px-3 py-2 align-top text-right">
                      <DeleteRowButton id={String(o._id)} name={o.name} noun="outlet" action={deleteRestaurant} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {outlets.length > 0 ? (
              <Pagination page={page} pageSize={pageSize} total={outlets.length} buildHref={paginationHref} />
            ) : null}
          </Card>
        </>
      )}
    </div>
  )
}
