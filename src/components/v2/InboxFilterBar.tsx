'use client'

import { Search } from 'lucide-react'
import { QueryForm } from '@/components/QueryForm'
import type { DateFilterMode } from '@/lib/dateFilter'
import { isFiltered, type InboxFilter } from '@/lib/inbox'
import { ButtonLink, cx, v2Focus } from './ui'
import { DateFilter } from './DateFilter'
import { Select } from './Select'

type Option = { value: string; label: string }

/** The pill-shaped text field every v2 filter bar uses. */
export const inboxFieldClass = cx(
  'h-10 min-w-0 rounded-full border border-v2-line bg-v2-surface px-3.5 text-sm text-v2-ink placeholder:text-v2-faint',
  v2Focus,
)

/**
 * Search and the narrowing selects, all in the URL so a filtered view survives
 * a refresh and "select all N matching" acts on exactly what is shown. The
 * dates are the shared DateFilter; this list opens on all time, so an
 * unparsed email from last week does not vanish.
 */
export function InboxFilterBar({
  filter,
  dates,
  sources,
  senders,
}: {
  filter: InboxFilter
  dates: { mode: DateFilterMode; month: string; from: string; to: string }
  sources: Option[]
  senders: Option[]
}) {
  const filtered = isFiltered(filter) || dates.mode !== 'all'

  return (
    <QueryForm className="grid grid-cols-[minmax(0,1fr)] gap-2 md:flex md:flex-wrap md:items-center">
      {filter.resolved ? <input type="hidden" name="show" value="resolved" /> : null}
      {filter.reason ? <input type="hidden" name="reason" value={filter.reason} /> : null}

      <label className="relative min-w-0 md:flex-1 md:basis-64">
        <span className="sr-only">Search subject, sender, body or order id</span>
        <Search size={16} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-v2-faint" />
        <input type="search" name="q" defaultValue={filter.q} placeholder="Search subject, sender, body, order id" className={cx(inboxFieldClass, 'w-full pl-9')} />
      </label>

      <Select
        name="source"
        aria-label="Aggregator"
        defaultValue={filter.source ?? ''}
        submitOnChange
        className="w-full md:w-auto md:min-w-[11rem]"
        options={[{ value: '', label: 'All aggregators' }, ...sources]}
      />

      <Select
        name="sender"
        aria-label="Sender"
        defaultValue={filter.sender ?? ''}
        submitOnChange
        className="w-full md:w-60"
        options={[
          { value: '', label: 'All senders' },
          ...(filter.sender && !senders.some((s) => s.value === filter.sender) ? [{ value: filter.sender, label: filter.sender }] : []),
          ...senders,
        ]}
      />

      <DateFilter key={`${dates.mode}|${dates.month}|${dates.from}|${dates.to}`} mode={dates.mode} month={dates.month} from={dates.from} to={dates.to} allowAll autoSubmit />

      {/* Enter in the search box submits; this is for pointer users. */}
      <button type="submit" className="sr-only">
        Search
      </button>

      {filtered ? (
        <ButtonLink href={filter.resolved ? '/v2/inbox?show=resolved' : '/v2/inbox'} variant="ghost" size="md">
          Clear
        </ButtonLink>
      ) : null}
    </QueryForm>
  )
}
