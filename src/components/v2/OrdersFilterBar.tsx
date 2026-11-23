import { Search } from 'lucide-react'
import { QueryForm } from '@/components/QueryForm'
import { ORDER_TYPES, ORDER_TYPE_LABEL } from '@/lib/orderEnums'
import { NO_RIDER } from '@/lib/repo/riderFilter'
import { hasOrderFilters, type OrderFilterOptions, type OrderFilters } from '@/lib/repo/orderFilters'
import type { SortKey } from '@/lib/v2/orders'
import { Button, ButtonLink, cx, statusChip } from './ui'
import { ordersFieldClass } from '@/lib/v2/ordersShared'
import { OrdersDateFilter } from './OrdersDateFilter'
import { OrdersFilterMore } from './OrdersFilterMore'
import { ChoiceChips } from './ChoiceChips'
import { OrdersStationSelect } from './OrdersStationSelect'
import { Select } from './Select'

/** The chip's word, capitalised, so the dropdown and the table use the same vocabulary. */
export function statusWord(status: string): string {
  const { label } = statusChip(status)
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/**
 * The Orders filter bar. Read with readOrderFilters and applied with
 * orderFilterClause (the same parser and clause as the v1 lookup and export),
 * plus payment and sort, which the table owns. Values other controls on the
 * page own (the view, the grouping, the returns toggle) ride as hidden inputs
 * so Apply never drops them.
 */
export function OrdersFilterBar({
  filters: f,
  options,
  payment,
  called = '',
  sort,
  showOutlet,
  showCalled = false,
  showDates,
  showSort,
  hidden,
  clearHref,
}: {
  filters: OrderFilters
  options: OrderFilterOptions
  payment: string
  /** '' | 'yes' | 'no': whether the passenger has a call note. Telecaller only. */
  called?: string
  sort: SortKey
  showOutlet: boolean
  showCalled?: boolean
  showDates: boolean
  showSort: boolean
  hidden: Record<string, string>
  clearHref: string
}) {
  const filtered = hasOrderFilters(f) || Boolean(payment) || Boolean(called)
  const moreActive = Boolean(f.train || f.outlet || f.type || f.rider || called || (options.stations.length > 8 && f.stations.length) || f.mode !== f.defaultMode)

  return (
    <QueryForm action="/v2/orders" className="grid gap-2.5">
      {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}

      <OrdersFilterMore
        active={activeCount(f, payment, called)}
        toolbar={
          <>
            <label className="relative block min-w-0 flex-1 basis-64">
              <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-v2-faint" aria-hidden />
              <input
                name="q"
                type="search"
                defaultValue={f.q}
                placeholder="Search name, phone, seat, train or order no."
                autoComplete="off"
                spellCheck={false}
                aria-label="Search orders"
                className={cx(ordersFieldClass, 'h-10 pl-10 text-[14.5px]')}
              />
            </label>
            <Button type="submit" variant="primary" className="h-10 w-10 !px-0" aria-label="Search" title="Search">
              <Search size={17} className="shrink-0" aria-hidden />
            </Button>
          </>
        }
        after={
          filtered ? (
            <ButtonLink href={clearHref} variant="ghost" className="h-10">
              Clear all
            </ButtonLink>
          ) : null
        }
      >
        <ChoiceChips
          label="Status"
          name="status"
          value={f.status}
          options={[
            { value: '', label: 'All' },
            { value: 'RECEIVED', label: 'New' },
            { value: 'ACCEPTED', label: 'Accepted' },
            { value: 'KOT_PRINTED', label: 'Cooking' },
            { value: 'PREPARED', label: 'Ready' },
            { value: 'DISPATCHED', label: 'With rider' },
            { value: 'DELIVERED', label: 'Delivered' },
            { value: 'FAILED', label: 'Not delivered' },
            { value: 'CANCELLED', label: 'Cancelled' },
          ]}
        />
        <ChoiceChips
          label="Payment"
          name="payment"
          value={payment}
          options={[
            { value: '', label: 'All' },
            { value: 'COD', label: 'Cash' },
            { value: 'PREPAID', label: 'Paid online' },
            { value: 'REFUNDED', label: 'Refunded' },
          ]}
        />
        {options.stations.length > 1 && options.stations.length <= 8 ? (
          <ChoiceChips
            label="Station"
            name="station"
            value={f.stations.length === 1 ? f.stations[0] : ''}
            options={[{ value: '', label: 'All' }, ...options.stations.map((st) => ({ value: st.code, label: st.name ? `${st.code} · ${st.name}` : st.code }))]}
          />
        ) : null}

        {/* Rarely needed: folded so the panel opens on three plain choices. */}
        <details className="group rounded-v2-md border border-v2-line bg-v2-surface" open={moreActive}>
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[14px] font-semibold text-v2-ink-2 [&::-webkit-details-marker]:hidden">
            More filters
            <span className="text-v2-muted transition-transform group-open:rotate-180" aria-hidden>
              ▾
            </span>
          </summary>
          <div className="grid gap-3 border-t border-v2-line p-4">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <input
                name="train"
                defaultValue={f.train}
                placeholder="Train number"
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                aria-label="Train number"
                className={cx(ordersFieldClass, 'font-mono placeholder:font-v2')}
              />
              {options.stations.length > 8 ? <OrdersStationSelect name="station" options={options.stations} defaultSelected={f.stations} /> : null}
              {showOutlet ? (
                <Select
                  name="outlet"
                  defaultValue={f.outlet}
                  aria-label="Outlet"
                  options={[{ value: '', label: 'All outlets' }, ...options.outlets.map((o) => ({ value: o.id, label: `${o.name} · ${o.stationCode}` }))]}
                />
              ) : null}
              <Select name="type" defaultValue={f.type} aria-label="Order type" options={[{ value: '', label: 'Any kind of order' }, ...ORDER_TYPES.map((t) => ({ value: t, label: ORDER_TYPE_LABEL[t] }))]} />
              <Select
                name="rider"
                defaultValue={f.rider}
                aria-label="Rider"
                options={[
                  { value: '', label: 'Any rider' },
                  { value: NO_RIDER, label: 'No rider yet' },
                  ...options.riders.map((r) => ({ value: r.id, label: `${r.name}${r.active ? '' : ' (inactive)'}` })),
                ]}
              />
              {showCalled ? (
                <Select
                  name="called"
                  defaultValue={called}
                  aria-label="Call state"
                  options={[
                    { value: '', label: 'Called or not' },
                    { value: 'no', label: 'Not called yet' },
                    { value: 'yes', label: 'Already called' },
                  ]}
                />
              ) : null}
              {showSort ? (
                <Select
                  name="sort"
                  defaultValue={sort}
                  aria-label="Order of the list"
                  options={[
                    { value: 'eta', label: 'Train arriving soonest' },
                    { value: 'newest', label: 'Newest order first' },
                  ]}
                />
              ) : null}
            </div>
            {showDates ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="text-[13px] font-semibold text-v2-ink-2">Dates</span>
                <OrdersDateFilter
                  key={`${f.mode}|${f.month}|${f.from}|${f.to}`}
                  mode={f.mode}
                  month={f.month}
                  from={f.from}
                  to={f.to}
                  allowAll
                  carryUnchanged={f.modeSet}
                />
              </div>
            ) : null}
            <div>
              <Button type="submit" variant="primary">
                Apply
              </Button>
            </div>
          </div>
        </details>
      </OrdersFilterMore>
    </QueryForm>
  )
}

/** How many of the folded controls narrow the list, for the phone toggle's badge. */
function activeCount(f: OrderFilters, payment: string, called: string): number {
  return [f.train, f.stations.length > 0, f.outlet, f.status, f.type, f.rider, payment, called, f.mode !== f.defaultMode].filter(Boolean).length
}
