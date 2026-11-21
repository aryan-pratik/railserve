import Link from 'next/link'
import { Search } from 'lucide-react'
import { requireRole } from '@/lib/session'
import { menuOverview } from '@/lib/repo/menuRepo'
import { MENU_CATEGORIES, menuCategory } from '@/lib/menuCategory'
import { ORDER_SOURCES, SOURCE_LABEL } from '@/lib/orderEnums'
import {
  MENU_TAGS, MENU_TAG_LABEL, hasMenuFilters, matchesTag, menuCounts, menuHref, needsCheck, readMenuFilters, sortMenu,
} from '@/lib/v2/menu'
import { QueryForm } from '@/components/QueryForm'
import { Button, ButtonLink, cx } from '@/components/v2/ui'
import { EmptyState, PageHeader, Pagination, PillTabs, TableFrame, readPaging } from '@/components/v2/Table'
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
  const ctx = await requireRole('ADMIN')
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

  return (
    <div className="grid gap-[18px]">
      <PageHeader
        title="Menu"
        note="Every dish each aggregator sends, tagged veg or non-veg. Non-veg prints on its own KOT; a tag that is not confirmed prints with a ? after its mark."
      />

      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 xl:grid-cols-5">
        <Stat label="Dishes" value={counts.all} href={menuHref(f, { tag: 'all' })} active={f.tag === 'all'} className="col-span-2 sm:col-span-1" />
        <Stat label="To check" value={counts.check} href={menuHref(f, { tag: 'check' })} active={f.tag === 'check'} note={counts.check ? 'suggested or not tagged' : 'all confirmed'} />
        <Stat label="Not tagged" value={counts.untagged} href={menuHref(f, { tag: 'untagged' })} active={f.tag === 'untagged'} />
        <Stat label="Veg" value={counts.VEG} href={menuHref(f, { tag: 'VEG' })} active={f.tag === 'VEG'} />
        <Stat label="Non-veg" value={counts.NON_VEG} href={menuHref(f, { tag: 'NON_VEG' })} active={f.tag === 'NON_VEG'} />
      </div>

      <section className="grid gap-3.5 rounded-v2-lg border border-v2-line bg-v2-surface p-[18px]">
        <QueryForm key={menuHref(f)} action="/v2/menu" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,15rem)_minmax(0,14rem)_minmax(0,1fr)_auto]">
          {f.tag !== 'all' ? <input type="hidden" name="tag" value={f.tag} /> : null}
          <AutoSelect
            name="source"
            defaultValue={f.source}
            aria-label="Aggregator"
            options={[
              { value: '', label: `All aggregators (${counts.all})` },
              ...sources.map((s) => {
                const c = perSource.get(s.id)
                return { value: s.id, label: `${s.label} (${c?.all ?? 0}${c?.check ? `, ${c.check} to check` : ''})` }
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
          <label className="relative block min-w-0">
            <span className="sr-only">Search dishes</span>
            <Search size={15} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-v2-faint" />
            <Input name="q" type="search" defaultValue={f.q} placeholder="Search dishes" autoComplete="off" className="pl-9" />
          </label>
          <div className="flex gap-2">
            <Button type="submit" className="flex-1 sm:flex-none">
              Search
            </Button>
            {filtering ? (
              <ButtonLink href="/v2/menu" variant="ghost">
                Reset
              </ButtonLink>
            ) : null}
          </div>
        </QueryForm>
        <PillTabs
          tabs={MENU_TAGS.map((t) => ({
            href: menuHref(f, { tag: t }),
            label: MENU_TAG_LABEL[t],
            count: inScope(t),
            active: f.tag === t,
          }))}
        />
      </section>

      {visible.length === 0 ? (
        <EmptyState
          title={filtering ? 'No dishes match' : 'No dishes yet'}
          note={
            filtering
              ? 'Try another aggregator, section or tag, or clear the search.'
              : 'Dishes appear here with the first order from each aggregator, or add one below.'
          }
          action={filtering ? <ButtonLink href="/v2/menu">Show every dish</ButtonLink> : undefined}
        />
      ) : (
        <TableFrame>
          <MenuTable rows={visible} asOf={asOf} sourceLabel={sourceLabel} sourceHref={sourceHref} showSource={!f.source} />
          <Pagination
            page={current}
            pageSize={pageSize}
            total={shown.length}
            buildHref={(t) => menuHref(f, {}, t)}
            className="border-t border-v2-line"
          />
        </TableFrame>
      )}

      <MenuAddForm sources={sources} />
    </div>
  )
}

/** One figure, and the link that narrows the table to it. */
function Stat({ label, value, href, active, note, className }: { label: string; value: number; href: string; active: boolean; note?: string; className?: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={cx(
        'grid content-start gap-2 rounded-v2-lg border p-[18px] transition-colors',
        className,
        active ? 'border-v2-brand bg-v2-brand-soft' : 'border-v2-line bg-v2-surface hover:bg-v2-surface-2',
      )}
    >
      <span className="text-[13px] font-semibold text-v2-ink-2">{label}</span>
      <span className="text-[34px] font-bold leading-none tracking-[-0.04em] tabular-nums">{value.toLocaleString('en-IN')}</span>
      {note ? <span className="text-xs text-v2-muted">{note}</span> : null}
    </Link>
  )
}
