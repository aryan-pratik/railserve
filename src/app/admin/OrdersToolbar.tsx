'use client'

import Link from 'next/link'
import { IconSearch, IconDownload } from '@/components/Icons'
import { DateFilter } from '@/components/DateFilter'
import type { DateFilterMode } from '@/lib/dateFilter'

export type ToolbarTab = { key: string; label: string; count: number; active: boolean }

export type ToolbarState = {
  tab: string
  mode: string
  month: string
  from: string
  to: string
  outlet: string
  train: string
  payment: string
  sort: string
  q: string
  group: string
  upcoming?: string
}

export function OrdersToolbar({
  tabs,
  outlets,
  trains,
  current,
  todayCount,
  upcomingCount,
}: {
  tabs: ToolbarTab[]
  outlets: { id: string; label: string }[]
  trains: string[]
  current: ToolbarState
  todayCount?: number
  upcomingCount?: number
}) {
  const hasActiveFilters = Boolean(current.outlet || current.train || current.payment || current.q)
  const isGrouped = current.group !== '0'
  const isUpcoming = current.upcoming === '1'

  const href = (over: Partial<ToolbarState>) => {
    const u = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...current, ...over })) {
      if (v !== undefined && v !== '') u.set(k, String(v))
    }
    const s = u.toString()
    return s ? `/admin?${s}` : '/admin'
  }

  const exportHref = (() => {
    const u = new URLSearchParams()
    if (current.mode) u.set('mode', current.mode)
    if (current.month) u.set('month', current.month)
    if (current.from) u.set('from', current.from)
    if (current.to) u.set('to', current.to)
    if (current.outlet) u.set('outlet', current.outlet)
    if (current.tab) u.set('tab', current.tab)
    if (current.upcoming) u.set('upcoming', current.upcoming)
    return `/admin/orders/export?${u}`
  })()

  return (
    <div className="space-y-3">
      {/* Row 1: Status Tabs + Group by Train Toggle + Export */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-0">
        {/* Clean Status Tabs with Underline Indicator */}
        <nav className="-mb-px flex flex-wrap items-center gap-6" aria-label="Order Status">
          {tabs.map((t) => (
            <Link
              key={t.key || 'all'}
              href={href({ tab: t.key })}
              aria-current={t.active ? 'page' : undefined}
              className={`flex items-center gap-2 border-b-2 py-3 text-sm font-medium transition-colors ${
                t.active
                  ? 'border-accent text-accent font-semibold'
                  : 'border-transparent text-muted hover:border-line-strong hover:text-ink'
              }`}
            >
              <span>{t.label}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
                  t.active
                    ? 'bg-accent-soft text-accent'
                    : 'bg-sunken text-muted'
                }`}
              >
                {t.count}
              </span>
            </Link>
          ))}
        </nav>

        {/* Right Actions: Today/Upcoming switcher + Group by Train toggle + Export */}
        <div className="flex items-center gap-3 py-1.5">
          {/* Today / Upcoming Toggle */}
          <div className="flex items-center rounded-lg border border-line bg-sunken/60 p-0.5 text-xs font-medium">
            <Link
              href={href({ upcoming: '', mode: '', month: '', from: '', to: '' })}
              className={`rounded-md px-2.5 py-1 transition-colors ${
                !isUpcoming
                  ? 'bg-surface text-ink font-semibold shadow-2xs'
                  : 'text-muted hover:text-ink'
              }`}
            >
              Today{todayCount !== undefined ? ` (${todayCount})` : ''}
            </Link>
            <Link
              href={href({ upcoming: '1', mode: '', month: '', from: '', to: '' })}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 transition-colors ${
                isUpcoming
                  ? 'bg-surface text-ink font-semibold shadow-2xs'
                  : 'text-muted hover:text-ink'
              }`}
            >
              <span>Upcoming</span>
              {upcomingCount !== undefined && upcomingCount > 0 ? (
                <span className="rounded-full bg-accent-soft px-1.5 py-0.2 text-[10px] font-bold text-accent">
                  {upcomingCount}
                </span>
              ) : null}
            </Link>
          </div>

          <span className="h-4 w-px bg-line" aria-hidden="true" />

          {/* Group by Train Toggle */}
          <Link
            href={href({ group: isGrouped ? '0' : '1' })}
            className="flex items-center gap-2 group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-lg"
          >
            <span
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out ${
                isGrouped ? 'bg-accent' : 'bg-line-strong'
              }`}
            >
              <span
                className={`pointer-events-none inline-block size-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out mt-0.5 ml-0.5 ${
                  isGrouped ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </span>
            <span className="text-xs font-medium text-ink group-hover:text-accent transition-colors">
              Group by Train
            </span>
          </Link>

          <span className="h-4 w-px bg-line" aria-hidden="true" />

          {/* Export Link */}
          <a
            href={exportHref}
            download
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <IconDownload size={14} />
            <span>Export</span>
          </a>
        </div>
      </div>

      {/* Row 2: Unified Single-Row Search and Filter Bar */}
      <form method="get" className="flex flex-wrap items-center gap-2.5">
        <input type="hidden" name="tab" value={current.tab} />
        <input type="hidden" name="group" value={current.group} />
        {isUpcoming ? <input type="hidden" name="upcoming" value="1" /> : null}

        {/* Search Input */}
        <div className="relative min-w-[220px] flex-1">
          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-faint">
            <IconSearch size={15} />
          </span>
          <input
            name="q"
            defaultValue={current.q}
            placeholder="Search by Order ID, Train No., PNR, Customer…"
            aria-label="Search orders"
            className="w-full rounded-xl border border-line bg-surface pl-9 pr-3 py-2 text-xs sm:text-sm text-ink outline-none transition placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent"
          />
        </div>

        {/* Outlet Filter */}
        <select
          name="outlet"
          defaultValue={current.outlet}
          aria-label="Filter by Outlet"
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="rounded-xl border border-line bg-surface px-3 py-2 text-xs sm:text-sm font-medium text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent"
        >
          <option value="">All Outlets</option>
          {outlets.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>

        {/* Train Filter */}
        <select
          name="train"
          defaultValue={current.train}
          aria-label="Filter by Train"
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="rounded-xl border border-line bg-surface px-3 py-2 text-xs sm:text-sm font-medium font-mono text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent"
        >
          <option value="">All Trains</option>
          {trains.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        {/* Payment Filter */}
        <select
          name="payment"
          defaultValue={current.payment}
          aria-label="Filter by Payment Mode"
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="rounded-xl border border-line bg-surface px-3 py-2 text-xs sm:text-sm font-medium text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent"
        >
          <option value="">All Payments</option>
          <option value="COD">COD</option>
          <option value="PREPAID">Prepaid</option>
          <option value="INVOICE">Invoice</option>
        </select>

        {/* Date Filter (Hidden when in upcoming mode) */}
        {!isUpcoming ? (
          <DateFilter
            mode={(current.mode || 'today') as DateFilterMode}
            month={current.month}
            from={current.from}
            to={current.to}
            autoSubmit
          />
        ) : null}

        {/* Sort Order */}
        <select
          name="sort"
          defaultValue={current.sort}
          aria-label="Sort order"
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="rounded-xl border border-line bg-surface px-3 py-2 text-xs sm:text-sm font-medium text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent"
        >
          <option value="urgent">Sort: Arriving soonest</option>
          <option value="newest">Sort: Newest First</option>
        </select>

        {/* Reset / Clear Filters Link */}
        {hasActiveFilters ? (
          <Link
            href={href({ q: '', outlet: '', train: '', payment: '' })}
            className="text-xs font-semibold text-accent underline-offset-2 hover:underline px-1 py-2"
          >
            Clear Filters
          </Link>
        ) : null}
      </form>
    </div>
  )
}
