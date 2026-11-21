'use client'

import { useRef } from 'react'
import Link from 'next/link'
import { ChevronsDownUp, ChevronsUpDown, LayoutList, Rows3, Search } from 'lucide-react'
import { QueryForm } from '@/components/QueryForm'
import { STATUS_GROUP_LABEL, isFiltered, type CallFilter, type CallState, type StatusGroup } from '@/lib/callBoard'
import { v2Input } from './CallsDialog'
import { Select } from './Select'
import { Button, ButtonLink, cx, v2Focus } from './ui'
import { setAllRunFolds } from './KitchenBits'

const CALL_OPTIONS: { value: CallState; label: string }[] = [
  { value: 'all', label: 'Everyone' },
  { value: 'todo', label: 'Not called' },
  { value: 'done', label: 'Called' },
]

/** A chip is a link, so a filter is a URL: shareable, back-button safe, untouched by the refresh. */
function FilterChip({ href, active, label, count }: { href: string; active: boolean; label: string; count: number }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={cx(
        'inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[12.5px] font-semibold transition-colors',
        active ? 'border-v2-ink bg-v2-ink text-v2-bg' : 'border-v2-line bg-v2-surface text-v2-ink-2 hover:bg-v2-surface-2',
        v2Focus,
      )}
    >
      {label}
      <span className={cx('rounded-md px-1 font-mono text-[11px] tabular-nums', active ? 'bg-white/20' : 'bg-v2-surface-2 text-v2-muted')}>{count}</span>
    </Link>
  )
}

/**
 * Finding, then narrowing. Search and outlet on the first line; who still
 * needs ringing and how far along the order is on the second. Every control
 * carries the others along, so nothing is lost by using one.
 */
export function CallsToolbar({
  filter,
  outlets,
  counts,
  carried,
  groupParam,
}: {
  filter: CallFilter
  /** Only when the viewer holds (or, as admin, sees) more than one outlet. */
  outlets: { id: string; name: string }[]
  counts: { call: Record<CallState, number>; status: Record<StatusGroup, number> }
  /** The day-tab params the chips do not own, carried through every link and the form. */
  carried: [string, string][]
  /** '' for grouped by train, '0' for the flat list. */
  groupParam: string
  /** Kept for the page's call site; the folds answer a window event now. */
  boardId?: string
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const isGrouped = groupParam !== '0'

  // Every link keeps everything else: the day tab, the group mode and the
  // other filters. Paging is dropped on purpose, since the set changes.
  const build = (next: CallFilter, group: string) => {
    const u = new URLSearchParams(carried)
    if (next.q) u.set('q', next.q)
    if (next.call !== 'all') u.set('call', next.call)
    if (next.status !== 'all') u.set('status', next.status)
    if (next.outlet) u.set('outlet', next.outlet)
    if (group) u.set('group', group)
    const s = u.toString()
    return s ? `/v2/calls?${s}` : '/v2/calls'
  }
  const hrefFor = (over: Partial<CallFilter>) => build({ ...filter, ...over }, groupParam)
  const groupHref = build(filter, isGrouped ? '0' : '')
  const clearHref = build({ q: '', call: 'all', status: 'all', outlet: '' }, groupParam)
  const statuses = (Object.keys(STATUS_GROUP_LABEL) as Exclude<StatusGroup, 'all'>[]).filter((k) => counts.status[k] > 0 || filter.status === k)

  const setAll = (open: boolean) => setAllRunFolds('calls', open)

  return (
    <div className="grid gap-3">
      <QueryForm ref={formRef} action="/v2/calls" className="flex flex-wrap items-center gap-2">
        {filter.call !== 'all' ? <input type="hidden" name="call" value={filter.call} /> : null}
        {filter.status !== 'all' ? <input type="hidden" name="status" value={filter.status} /> : null}
        {carried.map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        {groupParam ? <input type="hidden" name="group" value={groupParam} /> : null}
        <label className="relative min-w-[16rem] flex-1">
          <span className="sr-only">Search passengers</span>
          <Search size={16} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-v2-faint" />
          <input name="q" type="search" defaultValue={filter.q} placeholder="Name, phone, order id, seat, item or train" className={cx(v2Input, 'h-10 rounded-full pl-10')} />
        </label>
        {outlets.length > 1 ? (
          <Select
            name="outlet"
            aria-label="Outlet"
            defaultValue={filter.outlet}
            submitOnChange
            className="min-w-[11rem]"
            options={[{ value: '', label: 'All outlets' }, ...outlets.map((o) => ({ value: o.id, label: o.name }))]}
          />
        ) : null}
        <Button type="submit">Search</Button>
        {isFiltered(filter) ? (
          <Link href={clearHref} className={cx('rounded px-1 text-sm font-semibold text-v2-brand underline-offset-2 hover:underline', v2Focus)}>
            Clear all
          </Link>
        ) : null}
      </QueryForm>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Call state">
          {CALL_OPTIONS.map((o) => (
            <FilterChip key={o.value} href={hrefFor({ call: o.value })} active={filter.call === o.value} label={o.label} count={counts.call[o.value]} />
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Order status">
          <FilterChip href={hrefFor({ status: 'all' })} active={filter.status === 'all'} label="Any status" count={counts.status.all} />
          {statuses.map((k) => (
            <FilterChip key={k} href={hrefFor({ status: k })} active={filter.status === k} label={STATUS_GROUP_LABEL[k]} count={counts.status[k]} />
          ))}
        </div>
        <div className="flex items-center gap-1.5 sm:ml-auto">
          <ButtonLink href={groupHref} size="sm" variant="ghost" title={isGrouped ? 'Show one flat list of passengers' : 'Group passengers by train'}>
            {isGrouped ? <LayoutList size={14} aria-hidden /> : <Rows3 size={14} aria-hidden />}
            {isGrouped ? 'Flat list' : 'By train'}
          </ButtonLink>
          {isGrouped ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => setAll(true)}>
                <ChevronsUpDown size={14} aria-hidden />
                Expand all
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAll(false)}>
                <ChevronsDownUp size={14} aria-hidden />
                Collapse all
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
