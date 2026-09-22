import Link from 'next/link'
import { QueryForm } from '@/components/QueryForm'
import { IconSearch } from '@/components/Icons'
import { Button, Field, focusRing, inputClass, segmentedClass } from '@/components/ui'
import {
  STATUS_GROUP_LABEL,
  isFiltered,
  type CallFilter,
  type CallState,
  type StatusGroup,
} from '@/lib/callBoard'
import { ExpandCollapseAll } from './ExpandCollapseAll'

/** A chip is a link, so a filter is a URL: shareable, back-button safe, and untouched by the board's refresh. */
const chip = (active: boolean) =>
  'inline-flex h-11 items-center gap-1.5 rounded-md px-3.5 text-sm sm:h-9 sm:px-3 font-medium whitespace-nowrap transition-colors ' +
  `${focusRing} ${active ? 'bg-surface font-semibold text-ink shadow-2xs' : 'text-muted hover:text-ink'}`

const CALL_OPTIONS: { value: CallState; label: string }[] = [
  { value: 'all', label: 'Everyone' },
  { value: 'todo', label: 'Not called' },
  { value: 'done', label: 'Called' },
]

/**
 * Search and filters for the live board.
 *
 * Two rows on purpose. The first is finding: a search over what a passenger
 * reads out, and the outlet when the telecaller covers more than one. The
 * second is narrowing: who still needs ringing, and how far along the order is.
 * "Not called" is the one that matters most on a shift, so it sits first and
 * carries a count. There is no card around any of it: the board below is the
 * only boxed thing on the page, so the controls read as controls.
 */
export function LiveToolbar({
  filter,
  outlets,
  counts,
  targetId,
  dateQuery,
}: {
  filter: CallFilter
  /** Only passed when the viewer holds more than one outlet. */
  outlets: { id: string; name: string }[]
  counts: { call: Record<CallState, number>; status: Record<StatusGroup, number> }
  targetId: string
  /** 'yesterday=1' or 'upcoming=1' from the page's date tab, carried through every link and the form here. */
  dateQuery: string
}) {
  const href = (over: Partial<CallFilter>) => {
    const next = { ...filter, ...over }
    const u = new URLSearchParams(dateQuery)
    if (next.q) u.set('q', next.q)
    if (next.call !== 'all') u.set('call', next.call)
    if (next.status !== 'all') u.set('status', next.status)
    if (next.outlet) u.set('outlet', next.outlet)
    const s = u.toString()
    return s ? `/calls/live?${s}` : '/calls/live'
  }
  const clearHref = dateQuery ? `/calls/live?${dateQuery}` : '/calls/live'

  const statuses = (Object.keys(STATUS_GROUP_LABEL) as Exclude<StatusGroup, 'all'>[]).filter(
    (k) => counts.status[k] > 0 || filter.status === k,
  )

  return (
    <div className="space-y-4">
      <QueryForm action="/calls/live" className="flex flex-wrap items-end gap-3">
        {/* The chips below own these; the form only carries them along so a
            search does not throw the current filters away. */}
        {filter.call !== 'all' ? <input type="hidden" name="call" value={filter.call} /> : null}
        {filter.status !== 'all' ? <input type="hidden" name="status" value={filter.status} /> : null}
        {[...new URLSearchParams(dateQuery).entries()].map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}

        <div className="min-w-[14rem] flex-1">
          <Field label="Search passengers" htmlFor="live-q">
            <input
              id="live-q"
              name="q"
              type="search"
              defaultValue={filter.q}
              placeholder="Name, phone, order id, seat or train"
              className={`${inputClass} h-11`}
            />
          </Field>
        </div>

        {outlets.length > 1 ? (
          <div className="min-w-[12rem]">
            <Field label="Outlet" htmlFor="live-outlet">
              <select
                id="live-outlet"
                name="outlet"
                defaultValue={filter.outlet}
                className={`${inputClass} h-11`}
              >
                <option value="">All outlets</option>
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        ) : null}

        <Button type="submit" variant="secondary" className="h-11">
          <IconSearch size={15} />
          Search
        </Button>
        {isFiltered(filter) ? (
          <Link
            href={clearHref}
            className={`rounded pb-2.5 text-sm font-medium text-accent underline-offset-2 hover:underline ${focusRing}`}
          >
            Clear all
          </Link>
        ) : null}
      </QueryForm>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className={segmentedClass} role="group" aria-label="Call state">
          {CALL_OPTIONS.map((o) => (
            <Link
              key={o.value}
              href={href({ call: o.value })}
              aria-current={filter.call === o.value ? 'true' : undefined}
              className={chip(filter.call === o.value)}
            >
              {o.label}
              <span className="tabular-nums text-muted">{counts.call[o.value]}</span>
            </Link>
          ))}
        </div>

        <div className={segmentedClass} role="group" aria-label="Order status">
          <Link
            href={href({ status: 'all' })}
            aria-current={filter.status === 'all' ? 'true' : undefined}
            className={chip(filter.status === 'all')}
          >
            Any status
          </Link>
          {statuses.map((k) => (
            <Link
              key={k}
              href={href({ status: k })}
              aria-current={filter.status === k ? 'true' : undefined}
              className={chip(filter.status === k)}
            >
              {STATUS_GROUP_LABEL[k]}
              <span className="tabular-nums text-muted">{counts.status[k]}</span>
            </Link>
          ))}
        </div>

        <div className="sm:ml-auto">
          <ExpandCollapseAll targetId={targetId} />
        </div>
      </div>
    </div>
  )
}
