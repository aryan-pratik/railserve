import Link from 'next/link'
import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { GMAIL_STATE_ID, IngestState, Listing, Restaurant, Station, User } from '@/lib/models'
import { countOrders } from '@/lib/repo/orderRepo'
import { getAuthContext } from '@/lib/session'
import {
  Card, CardHeader, Dash, PageHeader, Pagination, Tabs, PAGE_SIZE_OPTIONS, thClass, focusRing,
} from '@/components/ui'
import { ROLE_LABEL } from '@/lib/roles'
import { OutletPills, StationPill, stationToneMap } from '@/components/OutletPills'
import { OutletFormModal } from './OutletFormModal'
import { StaffFormModal } from './StaffFormModal'
import { deleteRestaurant, toggleRestaurantActive } from './outletActions'
import { deleteUser, toggleUserActive } from './staffActions'
import { DeleteRowButton } from './DeleteRowButton'
import { AggregatorRow } from './AggregatorRow'
import { AggregatorsCell } from './AggregatorsCell'
import { StationDefaultForm } from './StationDefaultForm'
import { SenderAllowlist } from './SenderAllowlist'

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

const DEFAULT_PAGE_SIZE = 20

export default async function SetupPage(props: PageProps<'/admin/setup'>) {
  await requireRole('ADMIN')
  const sp = await props.searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''
  const tab = one(sp.tab)
  const staff = tab === 'staff'
  const aggregators = tab === 'aggregators'
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

  // Aggregator storefronts, the orders behind each, and each station's
  // fallback kitchen. Only fetched for the tab that shows them.
  const ctx = await getAuthContext()
  // Loaded for both tabs: Aggregators edits them, and Outlets needs them to
  // know which rows are storefronts and what feeds each kitchen.
  const listings = staff ? [] : await Listing.find({}).sort({ stationCode: 1, name: 1 }).lean()
  const stations = staff ? [] : await Station.find({}).lean()
  const allowedSenders = aggregators
    ? ((await IngestState.findOne({ _id: GMAIL_STATE_ID }).select('allowedSenders').lean())?.allowedSenders ?? [])
    : []
  const listingOrderCounts = new Map<string, number>()
  if (aggregators && ctx) {
    for (const l of listings) {
      // What this storefront actually brought in: its aggregator's orders at
      // the outlet it points to. Approximate by design — the order itself
      // records the aggregator, not the storefront name it arrived under.
      listingOrderCounts.set(
        String(l._id),
        l.restaurantId && l.source
          ? await countOrders(ctx, { restaurantId: l.restaurantId, source: l.source })
          : 0,
      )
    }
  }
  const defaultByStation = new Map(
    stations.map((st) => [String(st._id), st.defaultRestaurantId ? String(st.defaultRestaurantId) : null]),
  )

  const outletById = new Map(outlets.map((o) => [String(o._id), o]))

  const stationTone = stationToneMap(outlets.map((o) => o.stationCode))
  /**
   * The Outlets tab lists kitchens, and nothing else.
   *
   * A storefront retired by the listings migration is still a `restaurants`
   * row — history points at it and it is the print-token rollback path — but
   * showing it here invites exactly one mistake: pressing its Active toggle
   * brings an aggregator name back as an outlet, and `matchOutlet` then routes
   * that aggregator's orders to it instead of to the kitchen. So a row whose
   * (name, station) is a known storefront is filtered out.
   */
  const storefrontKey = new Set(
    listings.map((l) => `${l.name.trim().toUpperCase()}@${l.stationCode.toUpperCase()}`),
  )
  const kitchens = outlets.filter(
    (o) => !storefrontKey.has(`${o.name.trim().toUpperCase()}@${o.stationCode.toUpperCase()}`),
  )

  // What feeds each kitchen: storefronts pointed straight at it, plus the
  // unmapped ones its station sends here by default.
  const feedsByOutlet = new Map<string, { name: string; source: string | null; viaDefault: boolean }[]>()
  for (const l of listings) {
    if (!l.active) continue
    const target = l.restaurantId
      ? String(l.restaurantId)
      : (stations.find((st) => String(st._id) === l.stationCode)?.defaultRestaurantId ?? null)
    if (!target) continue
    const key = String(target)
    const list = feedsByOutlet.get(key) ?? []
    list.push({ name: l.name, source: l.source ?? null, viaDefault: !l.restaurantId })
    feedsByOutlet.set(key, list)
  }

  const outletsPage = staff ? [] : kitchens.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize)

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
        note={
          aggregators
            ? 'The names our kitchens trade under on each ordering platform, and which kitchen cooks for each. These are not outlets of ours — they are how an outlet appears to Zoop, Yatri Bhojan and the rest.'
            : 'Outlets are our own kitchens, one per station per brand. The platforms that send us orders live under Aggregators. Deactivate anything that has been used; delete only works on rows nothing points at.'
        }
      />

      <Tabs
        label="Setup"
        tabs={[
          { href: '/admin/setup', label: 'Outlets', count: kitchens.filter((o) => o.active).length, active: !staff && !aggregators },
          { href: '/admin/setup?tab=aggregators', label: 'Aggregators', active: aggregators },
          { href: '/admin/setup?tab=staff', label: 'Staff', active: staff },
        ]}
      />

      {aggregators ? (
        <div className="space-y-4">
          <SenderAllowlist senders={[...allowedSenders].sort()} />

          {/* One card per station: the storefronts there, then the fallback
              underneath them, because the fallback only makes sense once you
              can see what it is a fallback for. */}
          {[...new Set(listings.map((l) => l.stationCode))].sort().map((code) => {
            const here = listings.filter((l) => l.stationCode === code)
            const kitchens = outlets
              .filter((o) => o.active && o.stationCode === code)
              .map((o) => ({ id: String(o._id), name: o.name }))
            const defaultId = defaultByStation.get(code) ?? null
            const defaultName = defaultId ? (outletById.get(defaultId)?.name ?? null) : null

            return (
              <Card key={code} className="overflow-hidden">
                <CardHeader
                  title={
                    <span className="flex items-center gap-2">
                      <span className="font-mono">{code}</span>
                      <span className="text-muted">
                        {here.length} storefront{here.length === 1 ? '' : 's'} · {kitchens.length} kitchen
                        {kitchens.length === 1 ? '' : 's'}
                      </span>
                    </span>
                  }
                />
                <table className="w-full text-sm">
                  <thead className="border-b border-line bg-sunken/60">
                    <tr>
                      <th className={thClass}>Storefront name in the mail</th>
                      <th className={`${thClass} hidden sm:table-cell`}>Orders</th>
                      <th className={thClass}>Cooked by</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {here.map((l) => (
                      <AggregatorRow
                        key={String(l._id)}
                        listing={{
                          id: String(l._id),
                          name: l.name,
                          source: l.source ?? null,
                          stationCode: l.stationCode,
                          restaurantId: l.restaurantId ? String(l.restaurantId) : null,
                          orderCount: listingOrderCounts.get(String(l._id)) ?? 0,
                        }}
                        outlets={kitchens}
                        stationDefaultName={defaultName}
                      />
                    ))}
                  </tbody>
                </table>
                <div className="border-t border-line bg-sunken/40 px-3 py-2.5">
                  <StationDefaultForm stationCode={code} current={defaultId} outlets={kitchens} />
                </div>
              </Card>
            )
          })}

          {listings.length === 0 ? (
            <Card>
              <p className="px-3 py-6 text-center text-sm text-muted">
                No aggregator storefronts recorded yet. They appear here as orders arrive, or after
                running the listings migration.
              </p>
            </Card>
          ) : null}
        </div>
      ) : staff ? (
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
              title={`${kitchens.length} outlet${kitchens.length === 1 ? '' : 's'}`}
              action={<OutletFormModal />}
            />
            {/* No horizontal scroll: Station folds into the Outlet cell below
                md, Aliases disappear below xl, Aggregators below md, Walk
                below sm. Aggregators outranks Aliases for width — which
                platforms feed a kitchen is looked at far more often than the
                alternate spellings of its own name. */}
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-sunken/60">
                <tr>
                  <th className={thClass}>Outlet</th>
                  <th className={`${thClass} hidden md:table-cell`}>Station</th>
                  <th className={`${thClass} hidden md:table-cell`}>Aggregators</th>
                  <th className={`${thClass} hidden xl:table-cell`}>Aliases</th>
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
                      <div className="mt-1.5 md:hidden">
                        <AggregatorsCell listings={feedsByOutlet.get(String(o._id)) ?? []} />
                      </div>
                    </td>
                    <td className="hidden px-3 py-2.5 align-top md:table-cell">
                      <StationPill code={o.stationCode} name={o.stationName} tone={stationTone.get(o.stationCode)} />
                    </td>
                    <td className="hidden px-3 py-2.5 align-top md:table-cell">
                      <AggregatorsCell listings={feedsByOutlet.get(String(o._id)) ?? []} />
                    </td>
                    <td className="hidden px-3 py-2.5 align-top text-xs text-faint [overflow-wrap:anywhere] xl:table-cell">
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
            {kitchens.length > 0 ? (
              <Pagination page={page} pageSize={pageSize} total={kitchens.length} buildHref={paginationHref} />
            ) : null}
          </Card>
        </>
      )}
    </div>
  )
}
