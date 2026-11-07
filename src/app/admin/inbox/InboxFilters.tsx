'use client'

import Link from 'next/link'
import { QueryForm } from '@/components/QueryForm'
import { IconSearch } from '@/components/Icons'
import { ButtonLink, focusRing, inputBase } from '@/components/ui'
import { isFiltered, type InboxFilter, type InboxReason } from '@/lib/inbox'
import { REASON_DOT } from './reasonStyle'

type Option = { value: string; label: string }
type ReasonChip = { href: string; label: string; count: number; active: boolean; reason?: InboxReason }

/**
 * Search, reason chips and the narrowing selects. Everything lives in the URL,
 * so a filtered view survives a refresh and "select all matching" on the bulk
 * bar can act on exactly the rows it names.
 */
export function InboxFilters({
  filter,
  sources,
  senders,
  reasons,
}: {
  filter: InboxFilter
  sources: Option[]
  senders: Option[]
  reasons: ReasonChip[]
}) {
  const submitOnChange = (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) =>
    e.currentTarget.form?.requestSubmit()

  const selectClass = `${inputBase} h-9 w-full min-w-0 pr-8 text-sm sm:w-auto`

  return (
    <div className="space-y-3">
      <QueryForm className="flex flex-wrap items-center gap-2">
        {filter.resolved ? <input type="hidden" name="show" value="resolved" /> : null}
        {filter.reason ? <input type="hidden" name="reason" value={filter.reason} /> : null}

        <label className="relative min-w-0 flex-1 basis-64">
          <span className="sr-only">Search subject, sender, body or order id</span>
          <IconSearch
            size={16}
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint"
          />
          <input
            type="search"
            name="q"
            defaultValue={filter.q}
            placeholder="Search subject, sender, body, order id…"
            className={`${inputBase} h-9 w-full pl-8 text-sm`}
          />
        </label>

        <select
          name="source"
          aria-label="Aggregator"
          defaultValue={filter.source ?? ''}
          onChange={submitOnChange}
          className={selectClass}
        >
          <option value="">All aggregators</option>
          {sources.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>

        <select
          name="sender"
          aria-label="Sender"
          defaultValue={filter.sender ?? ''}
          onChange={submitOnChange}
          className={`${selectClass} sm:w-56`}
        >
          <option value="">All senders</option>
          {filter.sender && !senders.some((s) => s.value === filter.sender) ? (
            <option value={filter.sender}>{filter.sender}</option>
          ) : null}
          {senders.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>

        <div className="flex items-center gap-1.5">
          <input
            type="date"
            name="from"
            aria-label="Received from"
            defaultValue={filter.from ?? ''}
            onChange={submitOnChange}
            className={`${inputBase} h-9 w-[9.5rem] text-sm`}
          />
          <span className="text-xs text-faint">to</span>
          <input
            type="date"
            name="to"
            aria-label="Received to"
            defaultValue={filter.to ?? ''}
            onChange={submitOnChange}
            className={`${inputBase} h-9 w-[9.5rem] text-sm`}
          />
        </div>

        {/* Enter in the search box submits; this is for pointer users. */}
        <button type="submit" className="sr-only">Search</button>

        {isFiltered(filter) ? (
          <ButtonLink href={filter.resolved ? '/admin/inbox?show=resolved' : '/admin/inbox'} variant="ghost" size="md">
            Clear
          </ButtonLink>
        ) : null}
      </QueryForm>

      <nav aria-label="Reason" className="flex flex-wrap gap-1.5">
        {reasons.map((r) => (
          <Link
            key={r.label}
            href={r.href}
            scroll={false}
            aria-current={r.active ? 'true' : undefined}
            className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium ring-1 ring-inset transition-colors ${focusRing} ${
              r.active
                ? 'bg-ink text-surface ring-ink'
                : 'bg-surface text-muted ring-line-strong hover:bg-sunken hover:text-ink'
            }`}
          >
            {r.reason ? <span aria-hidden className={`size-1.5 rounded-full ${REASON_DOT[r.reason]}`} /> : null}
            {r.label}
            <span className={`tabular-nums ${r.active ? 'text-surface/70' : 'text-faint'}`}>{r.count}</span>
          </Link>
        ))}
      </nav>
    </div>
  )
}
