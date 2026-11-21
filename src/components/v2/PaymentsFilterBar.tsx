'use client'

import { Search } from 'lucide-react'
import { QueryForm } from '@/components/QueryForm'
import type { DateFilterMode } from '@/lib/dateFilter'
import { ButtonLink, cx, v2Focus } from './ui'
import { DateFilter } from './DateFilter'

const FIELD = cx('h-10 min-w-0 rounded-full border border-v2-line bg-v2-surface px-3.5 text-sm text-v2-ink placeholder:text-v2-faint', v2Focus)

/**
 * Search plus the date scope, all in the URL. The dates are the shared
 * DateFilter: a chip applies at once, and the choice rides as hidden inputs
 * so a search typed afterwards keeps it.
 */
export function PaymentsFilterBar({ q, mode, month, from, to, hasFilters }: { q: string; mode: DateFilterMode; month: string; from: string; to: string; hasFilters: boolean }) {
  return (
    <QueryForm className="grid grid-cols-[minmax(0,1fr)] gap-2.5 md:flex md:flex-wrap md:items-center">
      <label className="relative min-w-0 md:flex-1 md:basis-64">
        <span className="sr-only">Search payments by payer name, RRN or remark</span>
        <Search size={16} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-v2-faint" />
        <input type="search" name="q" defaultValue={q} placeholder="Payer, RRN or remark" autoComplete="off" spellCheck={false} className={cx(FIELD, 'w-full pl-9')} />
      </label>

      <DateFilter key={`${mode}|${month}|${from}|${to}`} mode={mode} month={month} from={from} to={to} allowAll autoSubmit />

      <button type="submit" className="sr-only">
        Search
      </button>

      {hasFilters ? (
        <ButtonLink href="/v2/payments" variant="ghost">
          Clear
        </ButtonLink>
      ) : null}
    </QueryForm>
  )
}
