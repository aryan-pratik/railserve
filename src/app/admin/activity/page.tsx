import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { Restaurant, User } from '@/lib/models'
import { activityFeed } from '@/lib/repo/activityRepo'
import {
  ACTIVITY_KINDS, ACTIVITY_PANELS, KIND_LABEL, KIND_PARAM, PANEL_LABEL, PANEL_PARAM, istDaysToRange, readKind,
  readPanel,
} from '@/lib/activity'
import { resolveDateRange, type DateFilterMode } from '@/lib/dateFilter'
import { formatDateRange, todayIST } from '@/lib/format'
import { readPage, withPage } from '@/lib/pagination'
import { ROLE_LABEL, type Role } from '@/lib/roles'
import { ActivityList } from '@/components/ActivityList'
import { DateFilter } from '@/components/DateFilter'
import { QueryForm } from '@/components/QueryForm'
import { Button, ButtonLink, Card, Field, PageHeader, Pagination, Tabs, inputClass } from '@/components/ui'

export const metadata = { title: 'Activity log · RailServe' }

const DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Everything that has happened, across every screen.
 *
 * One row per thing someone did to an order — or the system did — from the
 * admin console, the call desk, a store, a rider's web page and the rider
 * app, newest first. It is the event log every order already keeps, read
 * across all of them at once; see activityFeed for what that does and does
 * not cover.
 *
 * Always bounded by date, and opens on today: a log without a bound is every
 * event ever written, unwound on every page load.
 */
export default async function ActivityPage(props: PageProps<'/admin/activity'>) {
  const ctx = await requireRole('ADMIN')
  const sp = await props.searchParams

  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''
  const mode = (one(sp.mode) || 'today') as DateFilterMode
  const month = one(sp.month)
  const rawFrom = one(sp.from)
  const rawTo = one(sp.to)
  const panelParam = one(sp.panel)
  const panel = readPanel(panelParam)
  const kindParam = one(sp.kind)
  const kind = readKind(kindParam)
  const person = one(sp.person)
  const orderId = one(sp.orderId)
  const station = one(sp.station).toUpperCase()
  const { page, pageSize, skip } = readPage(sp)

  // A half-picked custom range still means something: one end alone is that
  // day, and an end before its start is read the right way round.
  const today = todayIST()
  const resolved = resolveDateRange(mode === 'all' ? 'today' : mode, { month, from: rawFrom, to: rawTo })
  let fromDay = DAY.test(resolved.from) ? resolved.from : DAY.test(resolved.to) ? resolved.to : today
  let toDay = DAY.test(resolved.to) ? resolved.to : DAY.test(resolved.from) ? today : fromDay
  if (toDay < fromDay) [fromDay, toDay] = [toDay, fromDay]

  await connectDb()
  const [feed, people, stations] = await Promise.all([
    activityFeed(ctx, {
      range: istDaysToRange(fromDay, toDay),
      panel,
      kind,
      actorId: person || null,
      orderId: orderId || null,
      stationCode: station || null,
      skip,
      limit: pageSize,
    }),
    User.find().select('name role active').sort({ role: 1, name: 1 }).lean(),
    Restaurant.distinct('stationCode'),
  ])

  // Every filter in play, for the tabs, the pager and the Clear link.
  const current = {
    mode: mode === 'today' ? '' : mode,
    month: mode === 'custom-month' ? month : '',
    from: mode === 'range' ? rawFrom : '',
    to: mode === 'range' ? rawTo : '',
    panel: panel ? panelParam : '',
    kind: kind ? kindParam : '',
    person,
    orderId,
    station,
  }
  const href = (over: Partial<typeof current>, target?: { page: number; pageSize: number }) => {
    const u = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...current, ...over })) if (v) u.set(k, v)
    const qs = (target ? withPage(u, target) : u).toString()
    return `/admin/activity${qs ? `?${qs}` : ''}`
  }

  const allCount = Object.values(feed.panelCounts).reduce((a, b) => a + b, 0)
  const tabs = [
    { href: href({ panel: '' }), label: 'All', count: allCount, active: !panel },
    ...ACTIVITY_PANELS.map((p) => ({
      href: href({ panel: PANEL_PARAM[p] }),
      label: PANEL_LABEL[p],
      count: feed.panelCounts[p],
      active: panel === p,
    })),
  ]

  const narrowed = Boolean(kind || person || orderId || station)
  const span = formatDateRange(fromDay, toDay)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Activity log"
        note={`Every recorded action on an order — from the admin console, call desk, stores, rider web and the rider app — newest first. ${span}.`}
      />

      <Tabs label="Screen" tabs={tabs} />

      <Card className="p-3">
        <QueryForm action="/admin/activity" className="grid items-end gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {/* The tabs own this value; without it, filtering would drop it. */}
          <input type="hidden" name="panel" value={current.panel} />
          <select name="kind" defaultValue={current.kind} className={inputClass} aria-label="What happened">
            <option value="">Anything</option>
            {ACTIVITY_KINDS.map((k) => (
              <option key={k} value={KIND_PARAM[k]}>{KIND_LABEL[k]}</option>
            ))}
          </select>
          <select name="person" defaultValue={person} className={inputClass} aria-label="Who">
            <option value="">Anyone</option>
            {people.map((u) => (
              <option key={String(u._id)} value={String(u._id)}>
                {u.name} · {ROLE_LABEL[u.role as Role] ?? u.role}
                {u.active === false ? ' (inactive)' : ''}
              </option>
            ))}
          </select>
          <select name="station" defaultValue={station} className={inputClass} aria-label="Station">
            <option value="">All stations</option>
            {[...stations].sort().map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <input name="orderId" defaultValue={orderId} placeholder="Order ID"
            autoComplete="off" spellCheck={false}
            className={`${inputClass} font-mono`} aria-label="Order ID" />
          <div className="flex gap-2">
            <Button type="submit" variant="secondary" className="flex-1">Apply</Button>
            {narrowed ? (
              <ButtonLink href={href({ kind: '', person: '', orderId: '', station: '' })} variant="ghost">
                Clear
              </ButtonLink>
            ) : null}
          </div>
          <div className="sm:col-span-2 lg:col-span-5">
            <Field label="Date">
              <DateFilter mode={mode === 'all' ? 'today' : mode} month={month} from={rawFrom} to={rawTo} />
            </Field>
          </div>
        </QueryForm>
      </Card>

      <Card className="overflow-hidden">
        <ActivityList
          rows={feed.rows}
          names={feed.names}
          emptyNote={
            narrowed || panel
              ? 'Nothing matches these filters on these dates. Try clearing them, or a wider date range.'
              : 'Nothing was recorded on these dates.'
          }
        />
        {feed.total > 0 ? (
          <div className="border-t border-line">
            <Pagination
              page={page}
              pageSize={pageSize}
              total={feed.total}
              buildHref={(target) => href({}, target)}
            />
          </div>
        ) : null}
      </Card>
    </div>
  )
}
