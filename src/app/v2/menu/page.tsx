import Link from 'next/link'
import { Search } from 'lucide-react'
import { requirePermission } from '@/lib/session'
import { menuOverview } from '@/lib/repo/menuRepo'
import { MENU_CATEGORIES, menuCategory } from '@/lib/menuCategory'
import { ORDER_SOURCES, SOURCE_LABEL } from '@/lib/orderEnums'
import {
  MENU_TAGS, MENU_TAG_LABEL, hasMenuFilters, matchesTag, menuCounts, menuHref, needsCheck, readMenuFilters, sortMenu,
} from '@/lib/v2/menu'
import { QueryForm } from '@/components/QueryForm'
import { ButtonLink } from '@/components/v2/ui'
import { BackToSettings } from '@/components/v2/BackToSettings'
import { EmptyState, PageHeader, Pagination, PillTabs, readPaging } from '@/components/v2/Table'
import { Input } from '@/components/v2/AnalyticsField'
import { AutoSelect } from '@/components/v2/AnalyticsAutoSelect'
import { MenuTable } from '@/components/v2/MenuTable'
import { MenuAddForm } from '@/components/v2/MenuAddForm'

export const metadata = { title: 'Menu · RailServe' }
export const dynamic = 'force-dynamic'

/**
 * The menu database: every dish each aggregator sends, tagged veg or
 * non-veg. This table is what the KOT splits on, so it is the one place to
 * fix a dish that printed on the wrong ticket.
 *
 * menuOverview returns the whole menu (a few hundred rows); the narrowing
 * and paging happen here on the server, so the URL is the state.
 */
export default async function V2MenuPage(props: PageProps<'/v2/menu'>) {
  const ctx = await requirePermission('menu.manage')
  const sp = await props.searchParams
  const f = readMenuFilters(sp)
  const { page, pageSize } = readPaging(sp)

  // Taken before the read: a tag saved after this moment may be missing from
  // `rows`, and the table keeps showing its own copy of it (see MenuTable).
  const asOf = new Date().getTime()
  const all = await menuOverview(ctx)

  const counts = menuCounts(all)
  const inSource = f.source ? all.filter((r) => r.source === f.source) : all
  const scoped = f.section ? inSource.filter((r) => menuCategory(r.name) === f.section) : inSource
  const needle = f.q.toLowerCase()
  const shown = sortMenu(scoped.filter((r) => matchesTag(r, f.tag) && (!needle || r.name.toLowerCase().includes(needle))))
  const pages = Math.max(1, Math.ceil(shown.length / pageSize))
  const current = Math.min(page, pages)
  const visible = shown.slice((current - 1) * pageSize, current * pageSize)

  const sources = ORDER_SOURCES.map((s) => ({ id: s, label: SOURCE_LABEL[s] }))
  const sourceLabel = Object.fromEntries(sources.map((s) => [s.id, s.label]))
  const sourceHref = Object.fromEntries(sources.map((s) => [s.id, menuHref(f, { source: s.id })]))
  const perSource = new Map<string, { all: number; check: number }>()
  for (const r of all) {
    const c = perSource.get(r.source) ?? { all: 0, check: 0 }
    c.all += 1
    if (needsCheck(r)) c.check += 1
    perSource.set(r.source, c)
  }
  const sectionCount = (c: string) => inSource.filter((r) => menuCategory(r.name) === c).length
  const inScope = (tag: (typeof MENU_TAGS)[number]) => scoped.filter((r) => matchesTag(r, tag)).length
  const filtering = hasMenuFilters(f)

  // The tabs people use; "Not tagged" only while there is something in it.
  const tabs = MENU_TAGS.filter((t) => t !== 'untagged' || counts.untagged > 0 || f.tag === 'untagged')

  return (
    <div className="grid gap-[18px]">
      <BackToSettings role={ctx.role} />
      <PageHeader
        title="Menu"
        note="Tag every dish veg or non-veg. Non-veg prints on its own kitchen ticket."
        actions={<MenuAddForm sources={sources} />}
      />

      {counts.check > 0 && f.tag !== 'check' ? (
        <Link
          href={menuHref(f, { tag: 'check' })}
          className="flex flex-wrap items-center justify-between gap-3 rounded-v2-lg border border-v2-warn/40 bg-v2-warn-bg px-4 py-3 text-[14px] hover:brightness-[0.98]"
        >
          <span>
            <b className="font-bold">{counts.check} dish{counts.check === 1 ? '' : 'es'} need a quick check.</b>{' '}
            <span className="text-v2-ink-2">Their veg or non-veg was guessed from the name.</span>
          </span>
          <span className="font-semibold text-v2-brand">Check them →</span>
        </Link>
      ) : null}

      <QueryForm key={menuHref(f)} action="/v2/menu" className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_minmax(0,13rem)]">
        {f.tag !== 'all' ? <input type="hidden" name="tag" value={f.tag} /> : null}
        <label className="relative block min-w-0">
          <span className="sr-only">Search dishes</span>
          <Search size={15} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-v2-faint" />
          <Input name="q" type="search" defaultValue={f.q} placeholder="Search dishes, then press Enter" autoComplete="off" className="pl-9" />
        </label>
        <AutoSelect
          name="source"
          defaultValue={f.source}
          aria-label="Aggregator"
          options={[
            { value: '', label: 'All aggregators' },
            ...sources.flatMap((s) => {
              const c = perSource.get(s.id)
              return c?.all || s.id === f.source ? [{ value: s.id, label: `${s.label} (${c?.all ?? 0})` }] : []
            }),
          ]}
        />
        <AutoSelect
          name="section"
          defaultValue={f.section}
          aria-label="Menu section"
          options={[
            { value: '', label: 'All sections' },
            ...MENU_CATEGORIES.flatMap((c) => {
              const n = sectionCount(c)
              return n > 0 || c === f.section ? [{ value: c, label: `${c} (${n})` }] : []
            }),
          ]}
        />
      </QueryForm>

      <div className="flex flex-wrap items-center gap-2">
        <PillTabs
          tabs={tabs.map((t) => ({
            href: menuHref(f, { tag: t }),
            label: MENU_TAG_LABEL[t],
            count: inScope(t),
            active: f.tag === t,
          }))}
        />
        {filtering ? (
          <ButtonLink href="/v2/menu" variant="ghost" size="sm">
            Clear filters
          </ButtonLink>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title={filtering ? 'No dishes match' : 'No dishes yet'}
          note={
            filtering
              ? 'Try another aggregator, section or tab, or clear the search.'
              : 'Dishes appear here with the first order from each aggregator, or add one with "Add a dish".'
          }
          action={filtering ? <ButtonLink href="/v2/menu">Show every dish</ButtonLink> : undefined}
        />
      ) : (
        <section className="overflow-hidden rounded-v2-lg border border-v2-line bg-v2-surface">
          <MenuTable rows={visible} asOf={asOf} sourceLabel={sourceLabel} sourceHref={sourceHref} showSource={!f.source} />
          <Pagination
            page={current}
            pageSize={pageSize}
            total={shown.length}
            buildHref={(t) => menuHref(f, {}, t)}
            className="border-t border-v2-line"
          />
        </section>
      )}
    </div>
  )
}
