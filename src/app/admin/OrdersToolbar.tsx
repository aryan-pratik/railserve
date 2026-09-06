'use client'

import Link from 'next/link'
import { IconDownload, IconSearch } from '@/components/Icons'
import { DateFilter } from '@/components/DateFilter'
import { GroupByTrainToggle } from '@/components/GroupByTrainToggle'
import { QueryForm } from '@/components/QueryForm'
import { LinkHint } from '@/components/LinkHint'
import { ButtonAnchor, Tabs, inputBase, inputClass, segmentClass, segmentedClass } from '@/components/ui'
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

/**
 * The board's controls. Two rows: what to show (status tabs, today or
 * upcoming, grouped or flat, export), then how to narrow it (search and
 * filters). Every change navigates client-side; nothing here reloads the
 * page.
 */
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
    for (const k of ['mode', 'month', 'from', 'to', 'outlet', 'tab', 'upcoming', 'train', 'payment'] as const) {
      const v = current[k]
      if (v) u.set(k, v)
    }
    return `/admin/orders/export?${u}`
  })()

  const submitOnChange = (e: React.ChangeEvent<HTMLSelectElement>) =>
    e.currentTarget.form?.requestSubmit()

  return (
    <div className="space-y-3">
      <Tabs
        label="Order status"
        tabs={tabs.map((t) => ({ href: href({ tab: t.key }), label: t.label, count: t.count, active: t.active }))}
        action={
          <>
            <div className={segmentedClass} role="group" aria-label="Service day">
              <Link href={href({ upcoming: '', mode: '', month: '', from: '', to: '' })} className={segmentClass(!isUpcoming)} aria-current={!isUpcoming ? 'page' : undefined}>
                Today
                {todayCount !== undefined ? <span className="tabular-nums text-muted">{todayCount}</span> : null}
                <LinkHint />
              </Link>
              <Link href={href({ upcoming: '1', mode: '', month: '', from: '', to: '' })} className={segmentClass(isUpcoming)} aria-current={isUpcoming ? 'page' : undefined}>
                Upcoming
                {upcomingCount ? <span className="tabular-nums text-muted">{upcomingCount}</span> : null}
                <LinkHint />
              </Link>
            </div>
            <GroupByTrainToggle href={href({ group: isGrouped ? '0' : '1' })} isGrouped={isGrouped} />
            <ButtonAnchor href={exportHref} download size="sm">
              <IconDownload size={14} />
              Export CSV
            </ButtonAnchor>
          </>
        }
      />

      <QueryForm action="/admin" className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="tab" value={current.tab} />
        <input type="hidden" name="group" value={current.group} />
        {isUpcoming ? <input type="hidden" name="upcoming" value="1" /> : null}

        <div className="relative min-w-[14rem] flex-1">
          <IconSearch size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            name="q"
            type="search"
            defaultValue={current.q}
            placeholder="Order id, train, name or phone"
            aria-label="Search orders"
            autoComplete="off"
            spellCheck={false}
            className={`${inputClass} pl-9`}
          />
        </div>

        <select name="outlet" defaultValue={current.outlet} aria-label="Outlet" onChange={submitOnChange} className={`${inputBase} max-w-[16rem]`}>
          <option value="">All outlets</option>
          {outlets.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>

        <select name="train" defaultValue={current.train} aria-label="Train" onChange={submitOnChange} className={`${inputBase} font-mono`}>
          <option value="">All trains</option>
          {trains.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        <select name="payment" defaultValue={current.payment} aria-label="Payment mode" onChange={submitOnChange} className={inputBase}>
          <option value="">All payments</option>
          <option value="COD">COD</option>
          <option value="PREPAID">Prepaid</option>
          <option value="INVOICE">Invoice</option>
        </select>

        {!isUpcoming ? (
          <DateFilter
            mode={(current.mode || 'today') as DateFilterMode}
            month={current.month}
            from={current.from}
            to={current.to}
            autoSubmit
          />
        ) : null}

        <select
          name="sort"
          defaultValue={current.sort}
          aria-label="Sort"
          onChange={submitOnChange}
          className={inputBase}
        >
          <option value="urgent">Arriving soonest</option>
          <option value="newest">Newest first</option>
        </select>

        {hasActiveFilters ? (
          <Link
            href={href({ q: '', outlet: '', train: '', payment: '' })}
            className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm font-medium text-accent hover:underline"
          >
            Clear filters
            <LinkHint />
          </Link>
        ) : null}
      </QueryForm>
    </div>
  )
}
