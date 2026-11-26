import { Search } from 'lucide-react'
import { requirePermission } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { Restaurant, User } from '@/lib/models'
import { activityFeed } from '@/lib/repo/activityRepo'
import { ACTIVITY_KINDS, ACTIVITY_PANELS, KIND_LABEL, KIND_PARAM, PANEL_LABEL, PANEL_PARAM, istDaysToRange } from '@/lib/activity'
import { formatDateRange } from '@/lib/format'
import { ROLE_LABEL, type Role } from '@/lib/roles'
import { activityHref, hasActivityFilters, readActivityParams } from '@/lib/v2/activity'
import { QueryForm } from '@/components/QueryForm'
import { Button, ButtonLink, Card } from '@/components/v2/ui'
import { BackToSettings } from '@/components/v2/BackToSettings'
import { EmptyState, PageHeader, Pagination, PillTabs, readPaging } from '@/components/v2/Table'
import { Input } from '@/components/v2/AnalyticsField'
import { AutoSelect } from '@/components/v2/AnalyticsAutoSelect'
import { DateFilter } from '@/components/v2/AnalyticsDateFilter'
import { ActivityFeed } from '@/components/v2/ActivityFeed'

export const metadata = { title: 'Activity · RailServe' }

/**
 * Everything that has happened, across every screen: one row per thing
 * someone did to an order, or the system did, newest first. It is the event
 * log every order already keeps, read across all of them at once; see
 * activityFeed for what that does and does not cover.
 */
export default async function V2ActivityPage(props: PageProps<'/v2/activity'>) {
  const ctx = await requirePermission('activity.view')
  const sp = await props.searchParams
  const p = readActivityParams(sp)
  const { page, pageSize, skip } = readPaging(sp)

  await connectDb()
  const [feed, people, stations] = await Promise.all([
    activityFeed(ctx, {
      range: istDaysToRange(p.fromDay, p.toDay),
      panel: p.panel,
      kind: p.kind,
      actorId: p.person || null,
      orderId: p.orderId || null,
      search: p.q || null,
      stationCode: p.station || null,
      skip,
      limit: pageSize,
    }),
    User.find({ tenantId: ctx.tenantId }).select('name role active').sort({ role: 1, name: 1 }).lean(),
    Restaurant.distinct('stationCode', { tenantId: ctx.tenantId }),
  ])

  const allCount = Object.values(feed.panelCounts).reduce((a, b) => a + b, 0)
  const tabs = [
    { href: activityHref(p, { panel: '' }), label: 'All', count: allCount, active: !p.panel },
    ...ACTIVITY_PANELS.map((panel) => ({
      href: activityHref(p, { panel: PANEL_PARAM[panel] }),
      label: PANEL_LABEL[panel],
      count: feed.panelCounts[panel],
      active: p.panel === panel,
    })),
  ]
  const narrowed = hasActivityFilters(p)

  return (
    <div className="grid gap-[18px]">
      <BackToSettings role={ctx.role} />
      <PageHeader
        title="Activity"
        note={`${formatDateRange(p.fromDay, p.toDay)} · ${allCount.toLocaleString('en-IN')} event${allCount === 1 ? '' : 's'} · every recorded action on an order, from every screen, newest first`}
      />

      <PillTabs tabs={tabs} />

      <Card>
        <QueryForm key={activityHref(p)} action="/v2/activity" className="grid gap-3">
          {/* The tabs own this value; without it, filtering would drop it. */}
          {p.panel ? <input type="hidden" name="panel" value={p.panelParam} /> : null}
          <DateFilter mode={p.mode} month={p.month} from={p.rawFrom} to={p.rawTo} autoSubmit />
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))_auto]">
            <label className="relative block min-w-0 sm:col-span-2 xl:col-span-1">
              <span className="sr-only">Search the log</span>
              <Search size={15} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-v2-faint" />
              <Input name="q" type="search" defaultValue={p.q} placeholder="Passenger, phone, train, coach, order or reason" autoComplete="off" spellCheck={false} className="pl-9" />
            </label>
            <AutoSelect
              name="kind"
              defaultValue={p.kind ? p.kindParam : ''}
              aria-label="What happened"
              options={[{ value: '', label: 'Anything' }, ...ACTIVITY_KINDS.map((k) => ({ value: KIND_PARAM[k], label: KIND_LABEL[k] }))]}
            />
            <AutoSelect
              name="person"
              defaultValue={p.person}
              aria-label="Who"
              options={[
                { value: '', label: 'Anyone' },
                ...people.map((u) => ({
                  value: String(u._id),
                  label: `${u.name} · ${ROLE_LABEL[u.role as Role] ?? u.role}${u.active === false ? ' (inactive)' : ''}`,
                })),
              ]}
            />
            <AutoSelect
              name="station"
              defaultValue={p.station}
              aria-label="Station"
              options={[{ value: '', label: 'All stations' }, ...[...stations].sort().map((s) => ({ value: s, label: s }))]}
            />
            <Input name="orderId" defaultValue={p.orderId} placeholder="Order id" aria-label="Order id" autoComplete="off" spellCheck={false} className="font-mono placeholder:font-v2" />
            <div className="flex gap-2">
              <Button type="submit" className="flex-1 xl:flex-none">
                Search
              </Button>
              {narrowed ? (
                <ButtonLink href={activityHref(p, { kind: '', person: '', orderId: '', q: '', station: '' })} variant="ghost">
                  Clear
                </ButtonLink>
              ) : null}
            </div>
          </div>
        </QueryForm>
      </Card>

      <Card className="p-0">
        {feed.rows.length === 0 ? (
          <EmptyState
            className="m-[18px]"
            title="Nothing recorded"
            note={
              narrowed || p.panel
                ? 'Nothing matches these filters on these dates. Clear them, or widen the date range.'
                : 'Nothing was recorded on these dates. Events appear here as orders are created, moved and edited.'
            }
            action={narrowed ? <ButtonLink href={activityHref(p, { kind: '', person: '', orderId: '', q: '', station: '' })}>Clear filters</ButtonLink> : undefined}
          />
        ) : (
          <>
            <ActivityFeed rows={feed.rows} names={feed.names} />
            <Pagination page={page} pageSize={pageSize} total={feed.total} buildHref={(t) => activityHref(p, {}, t)} className="border-t border-v2-line" />
          </>
        )}
      </Card>
    </div>
  )
}
